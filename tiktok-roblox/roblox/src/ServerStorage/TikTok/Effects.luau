--!nonstrict
--[[
	Efeitos descartaveis: nascem, aparecem, morrem.

	Tudo aqui vai para o `Debris`. E o caso em que ele e a ferramenta certa —
	prazo fixo, sem renovacao, sem dono. Sem isso, meia hora de live deixa
	alguns milhares de partes no Workspace e o servidor para de responder.
]]

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")

local Effects = {}

local SPHERE_LIFETIME = 18
local EXPLOSION_RADIUS = 14
local EXPLOSION_IMPULSE = 55

--[[
	Explosao INOFENSIVA.

	`BlastPressure = 0` e `DestroyJointRadiusPercent = 0` tiram o dano e a
	desmontagem de personagem: sobra o visual. O empurrao vem depois, aplicado a
	mao so no que e da plateia — assim o efeito e bonito na tela e nao arranca o
	personagem de quem esta transmitindo do lugar.
]]
function Effects.bomb(position: Vector3, container: Instance?)
	local explosion = Instance.new("Explosion")
	explosion.Position = position
	explosion.BlastRadius = EXPLOSION_RADIUS
	explosion.BlastPressure = 0
	explosion.DestroyJointRadiusPercent = 0
	explosion.ExplosionType = Enum.ExplosionType.NoCraters
	explosion.Parent = container or workspace

	local parts = workspace:GetPartBoundsInRadius(position, EXPLOSION_RADIUS)
	for _, part in parts do
		if part:IsA("BasePart") and not part.Anchored then
			-- Personagem de jogador de verdade fica de fora: o empurrao e para
			-- os bonecos da live, nao para quem esta jogando.
			local model = part:FindFirstAncestorOfClass("Model")
			local humanoid = model and model:FindFirstChildOfClass("Humanoid")
			local isPlayerCharacter = model and Players:GetPlayerFromCharacter(model)
			if not isPlayerCharacter then
				local direction = (part.Position - position)
				local distance = direction.Magnitude
				if distance > 0.1 then
					local falloff = 1 - math.min(distance / EXPLOSION_RADIUS, 1)
					local impulse = direction.Unit * EXPLOSION_IMPULSE * falloff * part.AssemblyMass
					pcall(function()
						part:ApplyImpulse(impulse + Vector3.new(0, impulse.Magnitude * 0.4, 0))
					end)
				end
				if humanoid then
					humanoid.PlatformStand = false
				end
			end
		end
	end
end

--- Esfera com fisica e o nome de quem pediu.
function Effects.sphere(position: Vector3, label: string, color: Color3, container: Instance?)
	local ball = Instance.new("Part")
	ball.Shape = Enum.PartType.Ball
	ball.Size = Vector3.new(3, 3, 3)
	ball.Position = position + Vector3.new(0, 12, 0)
	ball.Color = color
	ball.Material = Enum.Material.Neon
	ball.TopSurface = Enum.SurfaceType.Smooth
	ball.BottomSurface = Enum.SurfaceType.Smooth
	ball.CanTouch = false
	ball.CustomPhysicalProperties = PhysicalProperties.new(0.7, 0.3, 0.75, 1, 1)
	ball.Parent = container or workspace

	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(0, 140, 0, 26)
	gui.StudsOffset = Vector3.new(0, 2, 0)
	gui.MaxDistance = 120
	gui.Adornee = ball
	gui.Parent = ball

	local text = Instance.new("TextLabel")
	text.BackgroundTransparency = 1
	text.Size = UDim2.new(1, 0, 1, 0)
	text.Font = Enum.Font.GothamBold
	text.TextScaled = true
	text.TextColor3 = Color3.fromRGB(255, 255, 255)
	text.TextStrokeTransparency = 0.4
	text.Text = label
	text.Parent = gui

	-- Fisica no servidor: a maquina de quem transmite ja esta ocupada com o OBS.
	pcall(function()
		ball:SetNetworkOwner(nil)
	end)

	Debris:AddItem(ball, SPHERE_LIFETIME)
	return ball
end

--- Jato de particulas. Usado em presente, follow e share.
function Effects.confetti(position: Vector3, intensity: number, container: Instance?)
	local anchor = Instance.new("Part")
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanTouch = false
	anchor.Transparency = 1
	anchor.Size = Vector3.new(1, 1, 1)
	anchor.Position = position
	anchor.Parent = container or workspace

	local attachment = Instance.new("Attachment")
	attachment.Parent = anchor

	local emitter = Instance.new("ParticleEmitter")
	emitter.Rate = 0
	emitter.Lifetime = NumberRange.new(1.2, 2.4)
	emitter.Speed = NumberRange.new(18, 34)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Size = NumberSequence.new(0.6)
	emitter.Acceleration = Vector3.new(0, -22, 0)
	emitter.Color = ColorSequence.new(Color3.fromRGB(255, 90, 140), Color3.fromRGB(90, 190, 255))
	emitter.Parent = attachment

	-- `Emit` com contador limitado: `Rate` continuo vira fumaca permanente numa
	-- live cheia de presente.
	emitter:Emit(math.clamp(math.floor(intensity), 12, 160))
	Debris:AddItem(anchor, 4)
end

--- Brilho curto acima de alguem. E o que like vira: barato, porque like e muito.
function Effects.sparkle(part: BasePart)
	local attachment = Instance.new("Attachment")
	attachment.Position = Vector3.new(0, 3, 0)
	attachment.Parent = part

	local emitter = Instance.new("ParticleEmitter")
	emitter.Rate = 0
	emitter.Lifetime = NumberRange.new(0.5, 0.9)
	emitter.Speed = NumberRange.new(4, 9)
	emitter.SpreadAngle = Vector2.new(60, 60)
	emitter.Size = NumberSequence.new(0.35)
	emitter.Color = ColorSequence.new(Color3.fromRGB(255, 210, 90))
	emitter.Parent = attachment
	emitter:Emit(10)

	Debris:AddItem(attachment, 1.5)
end

return Effects
