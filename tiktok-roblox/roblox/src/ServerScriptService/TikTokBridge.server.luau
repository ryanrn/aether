--!nonstrict
--[[
	=========================================================================
	PONTE TIKTOK -> ROBLOX  (Script de SERVIDOR)
	=========================================================================

	O que este script faz, em uma frase: pergunta para o servidor Node o que a
	live comentou e manda o `Actions.luau` fazer aquilo acontecer no mapa.

	-------------------------------------------------------------------------
	ANTES DE RODAR: LIGAR O HttpService
	-------------------------------------------------------------------------
	Sem isto, TODA chamada abaixo lanca erro:

	  Studio -> Home -> Game Settings -> Security -> "Allow HTTP Requests" (ON)

	ou, na barra de comandos (View -> Command Bar):

	  game:GetService("HttpService").HttpEnabled = true

	Duas coisas que economizam meia hora de confusao:

	  1. HttpService so funciona em script de SERVIDOR. LocalScript nao faz
	     requisicao HTTP, e nao existe configuracao que libere isso.
	  2. "localhost" so alcanca o seu PC quando quem roda e o STUDIO. Em jogo
	     publicado, o servidor esta num datacenter da Roblox e localhost e a
	     propria maquina de la — voce precisa de um endereco publico (tunel).
	     O README explica.

	-------------------------------------------------------------------------
	COMO O LOOP FUNCIONA (long polling, e nao polling curto)
	-------------------------------------------------------------------------
	Pedimos com `wait=20000`: a ponte SEGURA a resposta ate ter comentario novo,
	ou 20 segundos. Uma requisicao que fica esperando entrega em milissegundos
	e gasta ~3 requisicoes por minuto — o HttpService permite 500 por servidor.
	Polling curto (pedir a cada 1s) gastaria 60 e ainda chegaria mais tarde.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")

local TikTok = ServerStorage:WaitForChild("TikTok")
local Config = require(TikTok.Config)
local Bridge = require(TikTok.Bridge)
local Filter = require(TikTok.Filter)
local ActorPool = require(TikTok.ActorPool)
local Effects = require(TikTok.Effects)
local Actions = require(TikTok.Actions)

-- ------------------------------------------------------------------ pre-voo

if not HttpService.HttpEnabled then
	error(
		"[TikTok] HttpService desligado. Game Settings -> Security -> Allow HTTP Requests, "
			.. 'ou rode na barra de comandos: game:GetService("HttpService").HttpEnabled = true'
	)
end

-- ------------------------------------------------------------------- canais

--[[
	Dois canais de saida, porque servem a publicos diferentes:

	- BindableEvent (servidor -> servidor): outro script SEU reage a acao sem
	  precisar conhecer a ponte. E onde voce pluga a mecanica do seu jogo.
	- RemoteEvent (servidor -> cliente): interface, som, contador na tela. O
	  cliente RECEBE e nunca manda — quem manda comando aqui e a live, e cliente
	  que pudesse disparar acao seria uma porta aberta para qualquer exploit.

	Os dois sao criados aqui em vez de virem prontos na arvore para o setup ser
	"cole a pasta e rode", sem instancia esquecida.
]]
local actionEvent = TikTok:FindFirstChild("ActionEvent")
if not actionEvent then
	actionEvent = Instance.new("BindableEvent")
	actionEvent.Name = "ActionEvent"
	actionEvent.Parent = TikTok
end

local feed = ReplicatedStorage:FindFirstChild("TikTokFeed")
if not feed then
	feed = Instance.new("RemoteEvent")
	feed.Name = "TikTokFeed"
	feed.Parent = ReplicatedStorage
end

-- --------------------------------------------------------------------- host

--[[
	Quem transmite. Serve para o filtro de texto (a Roblox exige um userId real
	para atribuir a chamada) e para o anti-AFK saber de quem e o personagem.
]]
local function adoptHost(player: Player)
	if Config.hostUserId == 0 then
		Config.hostUserId = player.UserId
		print(("[TikTok] host: %s (%d)"):format(player.Name, player.UserId))
	end
	-- O anti-AFK roda no cliente e precisa saber de quem e a sessao a manter
	-- viva. Atributo replica sozinho e nao pede mais um RemoteEvent.
	feed:SetAttribute("HostUserId", Config.hostUserId)
	if player.UserId == Config.hostUserId then
		if player.Character then
			ActorPool.markHost(player.Character)
		end
		player.CharacterAdded:Connect(function(character)
			ActorPool.markHost(character)
		end)
	end
end

for _, player in Players:GetPlayers() do
	adoptHost(player)
end
Players.PlayerAdded:Connect(adoptHost)

-- ------------------------------------------------------------------- estado

ActorPool.init({ config = Config, filter = Filter })

local container = Instance.new("Folder")
container.Name = "TikTokEfeitos"
container.Parent = workspace

local context = {
	config = Config,
	pool = ActorPool,
	effects = Effects,
	filter = Filter,
	container = container,
}

local bridge = Bridge.new(Config)
local cursor = 0
local failures = 0
local received = 0

--- Quadros por segundo do SERVIDOR, media curta. Vai no sinal de vida.
local frameTime = 1 / 60
RunService.Heartbeat:Connect(function(delta)
	frameTime = frameTime * 0.95 + delta * 0.05
end)

-- ------------------------------------------------------- campainha opcional

--[[
	So faz sentido com `Config.longPollMs = 0`. Com long polling a resposta ja
	volta no instante em que o comentario chega — nao ha o que acordar.

	MessagingService NAO funciona no Studio e exige o jogo publicado com uma
	chave de Open Cloud configurada na ponte.
]]
local doorbell = false
if Config.longPollMs == 0 then
	local ok, err = pcall(function()
		game:GetService("MessagingService"):SubscribeAsync("tiktok-bridge", function()
			doorbell = true
		end)
	end)
	if not ok then
		warn("[TikTok] sem campainha (normal no Studio): " .. tostring(err))
	end
end

-- --------------------------------------------------------------- despacho

local function dispatch(actions)
	for index, action in actions do
		--[[
			Cada acao numa thread propria: uma que falhe (ou que renda, como a
			criacao de avatar por userId) nao pode segurar as outras nem matar
			o loop. O `pcall` de dentro e o que transforma erro de handler em
			aviso no Output em vez de ponte parada.
		]]
		task.spawn(function()
			local ok, err = pcall(Actions.dispatch, action, context)
			if not ok then
				warn(("[TikTok] acao %s de @%s falhou: %s"):format(
					tostring(action.kind),
					tostring(action.viewer and action.viewer.handle),
					tostring(err)
				))
				return
			end
			actionEvent:Fire(action)
			feed:FireAllClients(action)
		end)

		-- Espalha um lote grande por alguns frames: 40 bonecos no mesmo frame
		-- aparecem como engasgo na live.
		if index % 10 == 0 then
			task.wait()
		end
	end
end

-- ------------------------------------------------------------ laco principal

task.spawn(function()
	print(("[TikTok] ligando em %s (jogo \"%s\")"):format(Config.baseUrl, Config.gameId))

	while true do
		local response, err = bridge:pull(cursor)

		if response then
			failures = 0

			if cursor == 0 and response.perdidas and response.perdidas > 0 then
				-- Primeira volta: a fila ja tinha coisa de antes de o jogo subir.
				-- Nao e erro, e nao vamos executar comentario velho.
				print(("[TikTok] entrando ao vivo; %d acoes anteriores ignoradas"):format(response.perdidas))
			elseif response.perdidas and response.perdidas > 0 then
				warn(("[TikTok] %d acoes perdidas — o jogo ficou para tras da live"):format(response.perdidas))
			end

			cursor = response.cursor or cursor

			local actions = response.acoes or {}
			if #actions > 0 then
				received += #actions
				if Config.verbose then
					print(("[TikTok] %d acao(oes); fila=%s cursor=%d"):format(
						#actions,
						tostring(response.fila),
						cursor
					))
				end
				dispatch(actions)
			end

			if Config.longPollMs == 0 then
				-- Polling curto: espera o intervalo, mas corta a espera se a
				-- campainha tocar.
				local waited = 0
				while waited < Config.idleWaitSeconds and not doorbell do
					waited += task.wait(0.1)
				end
				doorbell = false
			end
		else
			failures += 1
			--[[
				Backoff exponencial com teto e ruido. O ruido importa quando
				varios servidores do mesmo jogo perdem a ponte junto: sem ele,
				todos voltam a bater no mesmo milissegundo.
			]]
			local delay = math.min(2 ^ math.min(failures, 5), 30)
			delay = delay * (0.7 + math.random() * 0.6)
			warn(("[TikTok] falha ao buscar (%s). Tentando de novo em %.1fs"):format(tostring(err), delay))
			task.wait(delay)
		end
	end
end)

-- ------------------------------------------------------------------ limpeza

task.spawn(function()
	while true do
		task.wait(1)
		ActorPool.sweep()
	end
end)

-- ------------------------------------------------------------ sinal de vida

if Config.heartbeatSeconds > 0 then
	task.spawn(function()
		while true do
			task.wait(Config.heartbeatSeconds)
			--[[
				Falhar aqui e irrelevante para o jogo: o sinal de vida existe
				para QUEM TRANSMITE ver no terminal que o jogo continua de pe.
				Se o host cair, o `/health` da ponte para de mostrar sinal e a
				pessoa descobre sem precisar olhar o Roblox.
			]]
			bridge:heartbeat({
				jogadores = #Players:GetPlayers(),
				bonecos = ActorPool.count(),
				acoesRecebidas = received,
				fpsServidor = math.floor(1 / math.max(frameTime, 0.001)),
				cursor = cursor,
			})
		end
	end)
end
