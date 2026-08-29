--!nonstrict
--[[
	Configuracao do lado do Roblox.

	A CHAVE NAO DEVERIA ESTAR AQUI EM TEXTO. Script de servidor nunca e enviado
	ao cliente, entao jogador nenhum le isto — o problema e o controle de
	versao e o compartilhamento do arquivo .rbxl. O caminho certo em jogo
	publicado e o Secrets Store: Creator Dashboard -> a experiencia ->
	Configuracoes -> Secrets, e o codigo abaixo le de la sozinho.

	No Studio o Secrets Store nao existe, entao o campo `key` continua servindo
	de encosto para desenvolvimento local.
]]

local HttpService = game:GetService("HttpService")

local Config = {}

--[[
	ONDE A PONTE ESTA.

	No Studio: "http://localhost:8080" funciona, porque o Studio roda na SUA
	maquina — o localhost e o seu PC mesmo.

	Em jogo PUBLICADO isso nao funciona de jeito nenhum: o servidor do jogo roda
	num datacenter da Roblox, e "localhost" la e o proprio datacenter. Publicado
	precisa de um endereco publico com HTTPS (ngrok/cloudflared) — veja o README.
]]
Config.baseUrl = "http://localhost:8080"

--- O `id` do jogo no games.json da ponte.
Config.gameId = "obby"

--- Nome do segredo no Secrets Store, quando o jogo estiver publicado.
Config.secretName = "tiktok_bridge_key"

--- Encosto para o Studio. Em producao, deixe vazio e use o Secrets Store.
Config.key = "chave-local-de-teste-1"

--[[
	Long polling: a ponte segura a resposta ate ter novidade (ou ate este
	tempo). E o que da latencia de milissegundos gastando ~3 requisicoes por
	minuto — o HttpService permite 500/min por servidor, entao sobra folga.

	Coloque 0 para voltar ao polling curto (uma requisicao a cada
	`idleWaitSeconds`). So faz sentido junto com a campainha via
	MessagingService, que precisa do jogo publicado.
]]
Config.longPollMs = 20000
Config.idleWaitSeconds = 1

--[[
	`RequestAsync` manda a chave no header, que e o certo. `GetAsync` nao aceita
	header nenhum e obriga a chave a viajar na URL, onde ela aparece em log de
	proxy e de tunel. So ligue isto se por algum motivo `RequestAsync` estiver
	bloqueado no seu ambiente.
]]
Config.useGetAsync = false

--- Teto de acoes por resposta. Acima disso o servidor do jogo engasga.
Config.maxBatch = 40

--- Quantos bonecos de espectador podem existir ao mesmo tempo.
Config.maxActors = 60

--- Quanto tempo um boneco fica sem receber comando antes de sumir (segundos).
Config.actorTtlSeconds = 90

--- Onde os bonecos nascem e o raio de espalhamento.
Config.spawnCenter = Vector3.new(0, 8, 0)
Config.spawnRadius = 22

--[[
	Dono da live. Serve para duas coisas:
	  1. o anti-AFK so mexe NESTE jogador (visitante nao tem o personagem
	     empurrado por um script que nao e dele);
	  2. e a identidade usada no filtro de texto da Roblox, que exige um userId
	     real para atribuir a chamada.

	0 = descobre sozinho pelo primeiro jogador que entrar.
]]
Config.hostUserId = 0

--- Manda sinal de vida para a ponte a cada N segundos (0 desliga).
Config.heartbeatSeconds = 15

--[[
	Animacao do comando "dancar". Precisa ser um asset PUBLICO ou seu; a Roblox
	recusa carregar animacao de terceiro, e nesse caso o `Actions.luau` cai no
	plano B (uns pulinhos). Deixe "" para pular a tentativa.
]]
Config.danceAnimationId = "rbxassetid://507771019"

--- Escreve no Output cada acao recebida. Desligue em live cheia.
Config.verbose = true

--[[
	Le a chave: Secrets Store primeiro, texto depois.

	O `pcall` nao e paranoia — `GetSecret` LANCA quando o segredo nao existe, e
	no Studio ele nunca existe.

	Devolve um `Secret` (nao uma string) quando vem do Secrets Store. Secret so
	pode ser usado em header de `RequestAsync`, e a Roblox censura o valor em
	qualquer log — motivo a mais para nao usar `GetAsync`, que teria de receber
	a chave em texto na URL.
]]
function Config.resolveKey(): any
	local ok, secret = pcall(function()
		return HttpService:GetSecret(Config.secretName)
	end)
	if ok and secret then
		return secret
	end
	return Config.key
end

return Config
