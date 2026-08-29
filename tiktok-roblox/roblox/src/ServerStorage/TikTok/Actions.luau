--!nonstrict
--[[
	O MAPA DE ACOES: `kind` -> funcao que mexe no mapa.

	Esta e a tabela que o enunciado pede em Luau. Repare no que ela NAO faz:
	ela nao le texto de comentario e nao conhece palavra-chave nenhuma. Quem
	traduz "pular" em `jump` e a ponte (`server/src/commands.ts`), e ha um
	motivo pratico — mudar a palavra la e salvar um arquivo; mudar aqui e
	republicar o jogo, o que derruba o servidor no meio da live.

	Para criar um comando novo:
	  1. uma linha em `commands.ts` (a palavra);
	  2. uma funcao aqui (o efeito).
	Se so um dos dois existir nada quebra: ou a palavra nao casa, ou a acao
	chega e e ignorada com aviso no Output.
]]

local Actions = {}

local CORES: { [string]: Color3 } = {
	vermelho = Color3.fromRGB(220, 50, 50),
	azul = Color3.fromRGB(50, 110, 230),
	verde = Color3.fromRGB(60, 200, 90),
	amarelo = Color3.fromRGB(245, 210, 60),
	roxo = Color3.fromRGB(150, 80, 220),
	rosa = Color3.fromRGB(255, 105, 180),
	laranja = Color3.fromRGB(255, 140, 40),
	preto = Color3.fromRGB(30, 30, 34),
	branco = Color3.fromRGB(240, 240, 245),
	cinza = Color3.fromRGB(130, 130, 138),
	dourado = Color3.fromRGB(230, 185, 60),
	ciano = Color3.fromRGB(60, 220, 220),
}

--- Cor pedida, ou uma estavel por pessoa quando o nome nao existe.
local function pickColor(action): Color3
	local wanted = tostring(action.params.arg or ""):lower()
	local color = CORES[wanted]
	if color then
		return color
	end
	local seed = 0
	for index = 1, #action.viewer.id do
		seed += string.byte(action.viewer.id, index)
	end
	return Color3.fromHSV((seed % 100) / 100, 0.65, 0.95)
end

local function positionOf(entry): Vector3?
	if entry and entry.primary then
		return entry.primary.Position
	end
	return nil
end

local handlers = {}

--- Aparecer no mapa. Renova o prazo se a pessoa ja tem boneco.
handlers.spawn = function(action, ctx)
	ctx.pool.spawn(action)
end

handlers.jump = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	if entry.humanoid then
		entry.humanoid.Jump = true
	elseif entry.primary then
		-- Boneco de reserva nao tem Humanoid: o pulo vira impulso.
		entry.primary:ApplyImpulse(Vector3.new(0, entry.primary.AssemblyMass * 55, 0))
	end
end

handlers.bomb = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local position = positionOf(entry) or ctx.config.spawnCenter
	ctx.effects.bomb(position, ctx.container)
end

handlers.sphere = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local position = positionOf(entry) or ctx.config.spawnCenter
	ctx.effects.sphere(position, "@" .. entry.handle, pickColor(action), ctx.container)
end

handlers.rocket = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	if not entry.primary then
		return
	end
	entry.primary.AssemblyLinearVelocity = Vector3.new(
		math.random(-8, 8),
		95,
		math.random(-8, 8)
	)
	ctx.effects.sparkle(entry.primary)
end

handlers.dance = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local humanoid = entry.humanoid
	if not humanoid then
		return
	end

	--[[
		Tentamos a emote de verdade. `LoadAnimation` falha quando o asset nao e
		publico nem do dono do jogo — e ai a pessoa nao pode ficar sem resposta
		nenhuma, entao o plano B sao tres pulinhos. Feio, mas responde.
	]]
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if animator and ctx.config.danceAnimationId ~= "" then
		local animation = Instance.new("Animation")
		animation.AnimationId = ctx.config.danceAnimationId
		local ok, track = pcall(function()
			return animator:LoadAnimation(animation)
		end)
		animation:Destroy()
		if ok and track then
			track:Play()
			task.delay(4, function()
				pcall(function()
					track:Stop()
					track:Destroy()
				end)
			end)
			return
		end
	end

	task.spawn(function()
		for _ = 1, 3 do
			humanoid.Jump = true
			task.wait(0.45)
		end
	end)
end

handlers.sprint = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local humanoid = entry.humanoid
	if not humanoid then
		return
	end
	local original = humanoid.WalkSpeed
	humanoid.WalkSpeed = 42
	local target = ctx.config.spawnCenter
		+ Vector3.new(math.random(-40, 40), 0, math.random(-40, 40))
	humanoid:MoveTo(target)
	task.delay(6, function()
		if humanoid.Parent then
			humanoid.WalkSpeed = original
		end
	end)
end

handlers.giant = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local humanoid = entry.humanoid
	if not humanoid then
		return
	end
	--[[
		Escala e propriedade de rig R15 (sao NumberValue filhos do Humanoid).
		Em R6 esses filhos nao existem, e o `if` abaixo simplesmente nao faz
		nada — sem erro, sem meia transformacao.
	]]
	local names = { "BodyHeightScale", "BodyWidthScale", "BodyDepthScale", "HeadScale" }
	local restore = {}
	for _, name in names do
		local value = humanoid:FindFirstChild(name)
		if value and value:IsA("NumberValue") then
			restore[name] = value.Value
			value.Value = value.Value * 1.7
		end
	end
	task.delay(10, function()
		if not humanoid.Parent then
			return
		end
		for name, original in restore do
			local value = humanoid:FindFirstChild(name)
			if value and value:IsA("NumberValue") then
				value.Value = original
			end
		end
	end)
end

handlers.color = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local color = pickColor(action)
	for _, part in entry.model:GetDescendants() do
		if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
			part.Color = color
		end
	end
end

handlers.despawn = function(action, ctx)
	ctx.pool.despawn(action.viewer.id)
end

--- Presente: quanto mais diamante, mais confete. Com teto, sempre.
handlers.gift = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local position = positionOf(entry) or ctx.config.spawnCenter
	local diamonds = tonumber(action.params.diamonds) or 1
	ctx.effects.confetti(position + Vector3.new(0, 4, 0), 12 + diamonds * 2, ctx.container)
	ctx.effects.sphere(position, "@" .. entry.handle, Color3.fromRGB(255, 200, 80), ctx.container)
end

--[[
	Like NAO cria boneco. Uma live media manda milhares deles, e cada um
	virando um Humanoid novo derruba o servidor em minutos. Quem ja esta no mapa
	ganha um brilho; quem nao esta continua de fora ate comentar.
]]
handlers.like = function(action, ctx)
	local entry = ctx.pool.get(action.viewer.id)
	if entry and entry.primary then
		ctx.effects.sparkle(entry.primary)
	end
end

handlers.follow = function(action, ctx)
	local entry = ctx.pool.spawn(action)
	local position = positionOf(entry) or ctx.config.spawnCenter
	ctx.effects.confetti(position + Vector3.new(0, 5, 0), 60, ctx.container)
end

handlers.share = handlers.follow

--- Avisa uma vez por tipo desconhecido; em live cheia, um aviso por acao cega
--- o Output e esconde o erro que importa.
local warned: { [string]: boolean } = {}

function Actions.dispatch(action, ctx)
	local handler = handlers[action.kind]
	if not handler then
		if not warned[action.kind] then
			warned[action.kind] = true
			warn(("[TikTok] acao \"%s\" chegou da ponte e nao tem handler aqui."):format(action.kind))
		end
		return
	end
	handler(action, ctx)
end

function Actions.has(kind: string): boolean
	return handlers[kind] ~= nil
end

return Actions
