--!nonstrict
--[[
	Cliente HTTP da ponte.

	Cuida de UMA coisa: falar com o servidor Node e devolver tabela do Luau.
	Quem decide o que fazer com a acao e o `Actions`; quem decide quando pedir
	de novo e o script principal.

	COMO LIGAR O HttpService (sem isto, toda chamada aqui lanca):

	  Studio -> aba Home -> Game Settings -> Security -> "Allow HTTP Requests"

	Ou, mais rapido, na barra de comandos do Studio (View -> Command Bar):

	  game:GetService("HttpService").HttpEnabled = true

	O HttpService so funciona em script de SERVIDOR. LocalScript nao faz
	requisicao HTTP no Roblox, por design — nao adianta tentar.
]]

local HttpService = game:GetService("HttpService")

local Bridge = {}
Bridge.__index = Bridge

--[[
	O HttpService permite 500 requisicoes por minuto POR SERVIDOR do jogo.
	Com long polling gastamos ~3. O contador existe para o caso de alguem
	baixar o `longPollMs` para zero e transformar o loop numa metralhadora:
	melhor avisar no Output do que descobrir pelo erro de limite.
]]
local WARN_THRESHOLD_PER_MINUTE = 300

function Bridge.new(config)
	local self = setmetatable({}, Bridge)
	self.config = config
	self.key = config.resolveKey()
	self.requests = 0
	self.windowStartedAt = os.clock()
	self.warned = false
	return self
end

function Bridge:_count()
	local now = os.clock()
	if now - self.windowStartedAt >= 60 then
		self.requests = 0
		self.windowStartedAt = now
		self.warned = false
	end
	self.requests += 1
	if self.requests > WARN_THRESHOLD_PER_MINUTE and not self.warned then
		self.warned = true
		warn(
			("[TikTok] %d requisicoes neste minuto. O limite do HttpService e 500 por servidor; "):format(self.requests)
				.. "aumente Config.longPollMs em vez de diminuir."
		)
	end
end

--[[
	Uma requisicao, ja decodificada.

	Devolve `dados, nil` em sucesso e `nil, motivo` em falha. Erro NAO vira
	`error()`: o loop principal precisa continuar vivo mesmo com a ponte fora do
	ar — a live nao para porque o notebook do transmissor trocou de wi-fi.
]]
function Bridge:_request(path: string, method: string, body: any)
	self:_count()

	local url = self.config.baseUrl .. path
	local ok, response

	if self.config.useGetAsync and method == "GET" then
		--[[
			Caminho alternativo, pedido explicitamente por quem so pode usar
			`GetAsync`. Ele NAO manda header, entao a chave vai na URL — e por
			isso ele nao aceita `Secret` do Secrets Store, so texto.
		]]
		local separator = string.find(url, "?") and "&" or "?"
		local withKey = url .. separator .. "key=" .. HttpService:UrlEncode(tostring(self.key))
		ok, response = pcall(function()
			return HttpService:GetAsync(withKey, true)
		end)
		if not ok then
			return nil, tostring(response)
		end
		local decoded, decodeError = self:_decode(response)
		return decoded, decodeError
	end

	ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = url,
			Method = method,
			Headers = {
				["x-bridge-key"] = self.key,
				["content-type"] = "application/json",
			},
			Body = body and HttpService:JSONEncode(body) or nil,
		})
	end)

	if not ok then
		-- Erro de transporte: DNS, TLS, tunel caido, HttpService desligado.
		return nil, tostring(response)
	end
	if not response.Success then
		--[[
			404 aqui quase sempre significa chave errada ou `gameId` que nao
			existe no games.json — a ponte responde igual para os dois casos de
			proposito, para nao confirmar a existencia do jogo a quem varre a
			internet atras do tunel.
		]]
		return nil, ("HTTP %d %s"):format(response.StatusCode, response.StatusMessage or "")
	end

	return self:_decode(response.Body)
end

function Bridge:_decode(raw: string)
	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not ok then
		return nil, "resposta nao e JSON valido"
	end
	if type(decoded) ~= "table" or decoded.ok ~= true then
		return nil, "resposta sem ok=true"
	end
	return decoded, nil
end

--- Busca as acoes depois de `cursor`. Segura a conexao ate `longPollMs`.
function Bridge:pull(cursor: number)
	local path = ("/v1/games/%s/pull?since=%d&max=%d&wait=%d"):format(
		self.config.gameId,
		cursor,
		self.config.maxBatch,
		self.config.longPollMs
	)
	return self:_request(path, "GET", nil)
end

--- Avisa a ponte que o jogo esta vivo. Falhar aqui nao e problema.
function Bridge:heartbeat(payload)
	return self:_request(("/v1/games/%s/heartbeat"):format(self.config.gameId), "POST", payload)
end

return Bridge
