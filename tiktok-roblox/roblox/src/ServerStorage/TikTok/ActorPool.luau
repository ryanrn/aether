--!nonstrict
--[[
	Os bonecos dos espectadores: criacao, reaproveitamento e limpeza.

	POR QUE ISTO NAO USA `Debris` PARA OS BONECOS.

	`Debris:AddItem` marca a hora da morte e pronto: nao da para adiar. Mas o
	boneco de quem esta comentando PRECISA durar mais — cada comando novo renova
	o prazo, e quem parou de comentar sai. Com Debris, ou todo mundo some no
	meio da interacao, ou ninguem some nunca. Efeito (bola, explosao, confete)
	continua com Debris, que e onde ele serve: nasce, vive X segundos, morre.

	TETO E DESPEJO. `maxActors` nao e enfeite: cada Humanoid custa CPU do
	servidor todo frame. Estourou o teto, sai quem falou ha mais tempo (LRU) —
	nunca quem acabou de comentar, que e justamente a pessoa olhando a tela
	esperando se ver.
]]

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local PhysicsService = game:GetService("PhysicsService")

local ActorPool = {}

local ACTORS_GROUP = "TikTokAtores"
local HOST_GROUP = "TikTokHost"

local config
local filter
local container: Folder
local template: Model? = nil

--- viewerId -> { model, humanoid, primary, handle, expiresAt, lastSeen }
local entries: { [string]: any } = {}
local count = 0

local function registerCollisionGroups()
	--[[
		Dois grupos:
		  - ator x ator desligado: 60 humanoides se empurrando viram uma pilha
		    tremendo, e a fisica disso come o servidor;
		  - ator x host desligado: o personagem de quem transmite nao pode ser
		    empurrado para fora do mapa pela plateia.
		`pcall` porque o limite de grupos e 32 e registrar duas vezes lanca.
	]]
	pcall(function()
		PhysicsService:RegisterCollisionGroup(ACTORS_GROUP)
	end)
	pcall(function()
		PhysicsService:RegisterCollisionGroup(HOST_GROUP)
	end)
	pcall(function()
		PhysicsService:CollisionGroupSetCollidable(ACTORS_GROUP, ACTORS_GROUP, false)
		PhysicsService:CollisionGroupSetCollidable(ACTORS_GROUP, HOST_GROUP, false)
	end)
end

local function applyGroup(model: Instance, group: string)
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") then
			part.CollisionGroup = group
			-- Nao precisamos de evento de toque em boneco de plateia, e cada
			-- parte com toque ligado e trabalho a mais para o servidor.
			part.CanTouch = false
		end
	end
end

--[[
	Boneco de reserva, sem Humanoid.

	Existe para o caso de `CreateHumanoidModelFromDescription` falhar (API fora
	do ar, jogo sem permissao). Melhor um bloco com o nome da pessoa do que a
	live inteira sem resposta nenhuma.
]]
local function buildFallbackModel(): Model
	local model = Instance.new("Model")

	local torso = Instance.new("Part")
	torso.Name = "Torso"
	torso.Size = Vector3.new(2, 2, 1)
	torso.TopSurface = Enum.SurfaceType.Smooth
	torso.BottomSurface = Enum.SurfaceType.Smooth
	torso.Parent = model

	local head = Instance.new("Part")
	head.Name = "Head"
	head.Shape = Enum.PartType.Ball
	head.Size = Vector3.new(1.4, 1.4, 1.4)
	head.CFrame = torso.CFrame * CFrame.new(0, 1.7, 0)
	head.TopSurface = Enum.SurfaceType.Smooth
	head.BottomSurface = Enum.SurfaceType.Smooth
	head.Parent = model

	local weld = Instance.new("WeldConstraint")
	weld.Part0 = torso
	weld.Part1 = head
	weld.Parent = torso

	model.PrimaryPart = torso
	return model
end

local function buildTag(parent: BasePart, handle: string, text: string)
	local gui = Instance.new("BillboardGui")
	gui.Name = "TikTokTag"
	gui.Size = UDim2.new(0, 210, 0, 46)
	gui.StudsOffset = Vector3.new(0, 2.4, 0)
	-- Sem teto de distancia, 60 placas desenhando ao mesmo tempo derrubam o FPS
	-- de quem transmite — e e o FPS dele que vai para a live.
	gui.MaxDistance = 140
	gui.AlwaysOnTop = false
	gui.Adornee = parent
	gui.Parent = parent

	local name = Instance.new("TextLabel")
	name.Name = "Handle"
	name.BackgroundTransparency = 1
	name.Size = UDim2.new(1, 0, 0.6, 0)
	name.Font = Enum.Font.GothamBold
	name.TextScaled = true
	name.TextColor3 = Color3.fromRGB(255, 255, 255)
	name.TextStrokeTransparency = 0.4
	name.Text = "@" .. handle
	name.Parent = gui

	local comment = Instance.new("TextLabel")
	comment.Name = "Comment"
	comment.BackgroundTransparency = 1
	comment.Position = UDim2.new(0, 0, 0.6, 0)
	comment.Size = UDim2.new(1, 0, 0.4, 0)
	comment.Font = Enum.Font.Gotham
	comment.TextScaled = true
	comment.TextColor3 = Color3.fromRGB(210, 220, 255)
	comment.TextStrokeTransparency = 0.6
	comment.Text = text
	comment.Parent = gui

	return gui
end

local function randomSpawnCFrame(): CFrame
	local angle = math.random() * math.pi * 2
	local distance = math.sqrt(math.random()) * config.spawnRadius
	local offset = Vector3.new(math.cos(angle) * distance, 0, math.sin(angle) * distance)
	return CFrame.new(config.spawnCenter + offset)
end

local function destroy(viewerId: string)
	local entry = entries[viewerId]
	if not entry then
		return
	end
	entries[viewerId] = nil
	count -= 1
	if entry.model then
		entry.model:Destroy()
	end
end

--- Tira o boneco de quem falou ha mais tempo.
local function evictOldest()
	local oldestId, oldestAt = nil, math.huge
	for viewerId, entry in entries do
		if entry.lastSeen < oldestAt then
			oldestId, oldestAt = viewerId, entry.lastSeen
		end
	end
	if oldestId then
		destroy(oldestId)
	end
end

function ActorPool.init(dependencies)
	config = dependencies.config
	filter = dependencies.filter

	registerCollisionGroups()

	container = Instance.new("Folder")
	container.Name = "TikTokAtores"
	container.Parent = workspace

	--[[
		UM modelo base, clonado a cada boneco.

		`CreateHumanoidModelFromDescription` e uma chamada que RENDE (yield) e
		bate na infraestrutura da Roblox. Uma por espectador, numa live com
		gente comentando junto, vira fila de chamadas pendentes e boneco
		aparecendo dez segundos depois do comentario. Clonar e instantaneo.
	]]
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescription(
			Instance.new("HumanoidDescription"),
			Enum.HumanoidRigType.R15
		)
	end)

	if ok and model then
		template = model
		template.Parent = nil
	else
		warn("[TikTok] nao consegui criar o boneco padrao; usando o de reserva. " .. tostring(model))
		template = buildFallbackModel()
	end
end

--- Marca o personagem de quem transmite, para a plateia nao empurrar ele.
function ActorPool.markHost(character: Model)
	applyGroup(character, HOST_GROUP)
end

function ActorPool.get(viewerId: string)
	return entries[viewerId]
end

function ActorPool.count(): number
	return count
end

--[[
	Cria o boneco de quem comentou — ou renova o que ja existe.

	`robloxUserId` so vem quando a pessoa escreveu "roblox <usuario>" na live e a
	ponte resolveu o id (o jogo nao consegue: o HttpService e proibido de falar
	com dominios roblox.com). Nesse caso vale a chamada cara: e o avatar DELA
	aparecendo, que e o momento que faz a pessoa comentar de novo.
]]
function ActorPool.spawn(action)
	local viewer = action.viewer
	local viewerId = viewer.id
	local now = os.clock()

	local handle = filter.forBroadcast(viewer.handle ~= "" and viewer.handle or viewer.nickname, config.hostUserId)
	local text = filter.forBroadcast(tostring(action.params.text or ""), config.hostUserId)

	local existing = entries[viewerId]
	if existing then
		existing.lastSeen = now
		existing.expiresAt = now + config.actorTtlSeconds
		local gui = existing.primary and existing.primary:FindFirstChild("TikTokTag")
		if gui and gui:FindFirstChild("Comment") then
			gui.Comment.Text = text
		end
		return existing
	end

	if count >= config.maxActors then
		evictOldest()
	end

	local model: Model? = nil
	if viewer.robloxUserId and viewer.robloxUserId > 0 then
		local ok, avatar = pcall(function()
			return Players:CreateHumanoidModelFromUserId(viewer.robloxUserId)
		end)
		if ok and avatar then
			model = avatar
		end
	end
	if not model then
		model = template and template:Clone() or buildFallbackModel()
	end

	model.Name = "Ator_" .. viewerId
	model:PivotTo(randomSpawnCFrame())

	local humanoid = model:FindFirstChildOfClass("Humanoid")
	if humanoid then
		-- O nome padrao do Humanoid duplicaria a placa que acabamos de montar.
		humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		humanoid.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
		humanoid.BreakJointsOnDeath = false
	end

	local primary = model.PrimaryPart
		or model:FindFirstChild("HumanoidRootPart")
		or model:FindFirstChildWhichIsA("BasePart")

	local head = model:FindFirstChild("Head") or primary
	if head and head:IsA("BasePart") then
		buildTag(head, handle, text)
	end

	applyGroup(model, ACTORS_GROUP)
	model.Parent = container

	--[[
		Simulacao no servidor, nao no cliente de quem transmite. Por padrao a
		Roblox entrega a fisica de qualquer coisa perto do jogador para a
		maquina dele — e a maquina dele esta ocupada codificando video. Alem
		disso, fisica no servidor mantem o que aparece na live igual ao que o
		servidor considera verdade.
	]]
	if primary then
		pcall(function()
			primary:SetNetworkOwner(nil)
		end)
	end

	local entry = {
		model = model,
		humanoid = humanoid,
		primary = primary,
		handle = handle,
		lastSeen = now,
		expiresAt = now + config.actorTtlSeconds,
	}
	entries[viewerId] = entry
	count += 1
	return entry
end

function ActorPool.despawn(viewerId: string)
	local entry = entries[viewerId]
	if not entry then
		return
	end
	-- Some com um empurraozinho para cima em vez de sumir do nada: a live ve o
	-- que aconteceu.
	if entry.primary then
		pcall(function()
			entry.primary.AssemblyLinearVelocity = Vector3.new(0, 40, 0)
		end)
	end
	entries[viewerId] = nil
	count -= 1
	Debris:AddItem(entry.model, 1.5)
end

--- Tira quem passou do prazo. O script principal chama isto uma vez por segundo.
function ActorPool.sweep()
	local now = os.clock()
	for viewerId, entry in entries do
		if entry.expiresAt <= now or not entry.model.Parent then
			destroy(viewerId)
		end
	end
end

return ActorPool
