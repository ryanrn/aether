--!nonstrict
--[[
	=========================================================================
	ANTI-INATIVIDADE  (LocalScript — StarterPlayer/StarterPlayerScripts)
	=========================================================================

	O problema: a Roblox desconecta quem fica ~20 minutos sem enviar entrada.
	Numa live 24h o jogo esta rodando sozinho, e o host cai — a live continua
	e o jogo some da tela.

	O QUE ESTE SCRIPT FAZ, E O QUE ELE NAO GARANTE. Vale ler antes de confiar:

	  O contador de inatividade da Roblox e alimentado por ENTRADA DE USUARIO
	  (teclado, mouse, toque) lida pelos scripts internos do cliente. Mexer o
	  personagem por codigo nao alimenta esse contador: o `Humanoid` anda, e o
	  cronometro continua correndo do mesmo jeito.

	  Entao aqui fazemos as tres camadas que DAO para fazer de dentro do jogo:

	  1. `Player.Idled` — o evento que dispara quando a Roblox ja considera a
	     sessao ociosa. E o gancho oficial e o unico aviso que o jogo recebe.
	  2. `VirtualUser`, dentro de `pcall`. Em alguns contextos ele injeta um
	     clique sintetico que conta como entrada; em outros a chamada e barrada
	     por nivel de seguranca. Tentar e barato; supor que funcionou nao e —
	     por isso a tentativa e registrada e o resto continua valendo.
	  3. Micro-movimento e um giro minusculo de camera a cada intervalo. Isso
	     mantem o personagem "vivo" na tela (e evita que o jogo pareca
	     congelado na live) mesmo quando as duas primeiras nao pegam.

	  A UNICA forma que resolve com certeza e ENTRADA DE VERDADE, vinda do
	  sistema operacional. Por isso a pasta `host/` tem dois scripts de dez
	  linhas (Windows e Linux) que cutucam a janela do Roblox de tempos em
	  tempos. Rode um deles junto com o OBS.

	  Isto e para a SUA conta, no SEU PC, na SUA experiencia. Automatizar
	  entrada em conta de terceiro ou para farmar recompensa e outra conversa, e
	  nao e para isso que este arquivo existe.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer

--- De quanto em quanto tempo cutucar, mesmo sem `Idled` ter disparado.
local INTERVALO = 120
--- Tamanho do passo. Precisa ser pequeno para nao tirar o host do lugar.
local PASSO = 0.05
--- Giro de camera por cutucada, em graus.
local GIRO = 0.4

-- ------------------------------------------------------------------- guarda

--[[
	So o dono da live e cutucado.

	Se alguem entrar para assistir de dentro do jogo, o personagem dessa pessoa
	nao pode comecar a se mexer sozinho — seria um script mexendo no personagem
	de quem nao pediu.
]]
local feed = ReplicatedStorage:WaitForChild("TikTokFeed", 30)
if not feed then
	return
end

local function ehHost(): boolean
	local hostUserId = feed:GetAttribute("HostUserId")
	-- Enquanto o servidor nao anunciou o host, ninguem e cutucado.
	return typeof(hostUserId) == "number" and hostUserId == player.UserId
end

-- ---------------------------------------------------------------- cutucadas

local function moverUmPouco()
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end

	--[[
		Ida e volta no mesmo frame seguinte: o personagem sai do lugar por uma
		fracao de segundo e volta. Sem a volta, duas horas de cutucada levam o
		host para fora do mapa.
	]]
	humanoid:Move(Vector3.new(PASSO, 0, 0), false)
	task.delay(0.15, function()
		if humanoid.Parent then
			humanoid:Move(Vector3.new(-PASSO, 0, 0), false)
			task.delay(0.15, function()
				if humanoid.Parent then
					humanoid:Move(Vector3.zero, false)
				end
			end)
		end
	end)
end

local function girarCamera()
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	-- Giro em torno do proprio eixo: nao muda o enquadramento da live de forma
	-- perceptivel, mas o frame renderizado nao e identico ao anterior.
	camera.CFrame = camera.CFrame * CFrame.Angles(0, math.rad(GIRO), 0)
	task.delay(0.2, function()
		if workspace.CurrentCamera == camera then
			camera.CFrame = camera.CFrame * CFrame.Angles(0, math.rad(-GIRO), 0)
		end
	end)
end

--[[
	`VirtualUser` e o caminho classico de anti-AFK. Ele e protegido, e o nivel
	de acesso depende do contexto em que o script roda — entao a chamada vai
	dentro de `pcall` e o resultado e REGISTRADO. Assim, se ela nao passar,
	aparece no console do cliente em vez de virar uma falsa sensacao de
	seguranca.

	`ClickButton2` (botao direito) de proposito: nao dispara clique de
	interface nem de ferramenta.
]]
local virtualUserOk: boolean? = nil

local function tentarVirtualUser()
	local ok = pcall(function()
		local virtualUser = game:GetService("VirtualUser")
		virtualUser:CaptureController()
		virtualUser:ClickButton2(Vector2.new())
	end)
	if virtualUserOk == nil then
		virtualUserOk = ok
		if ok then
			print("[anti-afk] VirtualUser disponivel neste contexto.")
		else
			warn(
				"[anti-afk] VirtualUser bloqueado neste contexto. Movimento e camera continuam, "
					.. "mas para garantir a sessao use o script da pasta host/."
			)
		end
	end
end

local function cutucar()
	if not ehHost() then
		return
	end
	tentarVirtualUser()
	moverUmPouco()
	girarCamera()
end

-- ------------------------------------------------------------------- gatilhos

--[[
	`Idled` dispara quando a Roblox ja marcou a sessao como ociosa; e o ultimo
	aviso antes da desconexao. O intervalo fixo abaixo existe para nem chegar
	ate aqui.
]]
player.Idled:Connect(function(tempoOcioso)
	warn(("[anti-afk] ocioso ha %ds — cutucando"):format(math.floor(tempoOcioso)))
	cutucar()
end)

task.spawn(function()
	-- Uma volta antes do primeiro intervalo so para registrar no console se o
	-- VirtualUser passa ou nao neste ambiente.
	task.wait(10)
	cutucar()
	while true do
		task.wait(INTERVALO)
		cutucar()
	end
end)
