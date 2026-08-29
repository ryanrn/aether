--!nonstrict
--[[
	Filtro de texto da Roblox.

	NAO E OPCIONAL. Qualquer texto escrito por outra pessoa e exibido dentro da
	experiencia — e o @ do TikTok e o comentario sao exatamente isso — precisa
	passar pelo `TextService`. E regra da plataforma, e quem ignora leva
	moderacao no jogo, nao no comentario.

	Duas decisoes:

	1. FALHA FECHADA. Se o filtro nao responder, mostramos "espectador" em vez
	   do texto original. O contrario (mostrar cru quando o filtro cai) e
	   justamente o caso em que voce nao quer estar.

	2. CACHE. O mesmo @ volta a cada comentario da mesma pessoa, e cada chamada
	   ao filtro e uma ida a rede que rende. O cache tem teto e descarta em
	   bloco: LRU de verdade aqui custaria mais que a chamada que ele evita.
]]

local TextService = game:GetService("TextService")

local Filter = {}

local CACHE_MAX = 600
local FALLBACK = "espectador"

local cache: { [string]: string } = {}
local cacheSize = 0

--[[
	`fromUserId` precisa ser de uma pessoa real na experiencia: e a atribuicao
	que a Roblox exige. Como quem comenta esta no TikTok e nao no jogo, usamos
	sempre o dono da live — o que tambem deixa o cache consistente, ja que o
	resultado do filtro depende de quem pede.
]]
function Filter.forBroadcast(text: string, fromUserId: number): string
	if text == nil or text == "" then
		return ""
	end
	if fromUserId == nil or fromUserId <= 0 then
		return FALLBACK
	end

	local cached = cache[text]
	if cached then
		return cached
	end

	local ok, result = pcall(function()
		return TextService:FilterStringAsync(text, fromUserId, Enum.TextFilterContext.PublicChat)
	end)
	if not ok or result == nil then
		return FALLBACK
	end

	local readOk, filtered = pcall(function()
		return result:GetNonChatStringForBroadcastAsync()
	end)
	if not readOk or type(filtered) ~= "string" then
		return FALLBACK
	end

	if cacheSize >= CACHE_MAX then
		cache = {}
		cacheSize = 0
	end
	cache[text] = filtered
	cacheSize += 1
	return filtered
end

return Filter
