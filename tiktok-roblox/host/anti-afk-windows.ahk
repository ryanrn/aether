; =====================================================================
; ANTI-INATIVIDADE - Windows (AutoHotkey v2)
; =====================================================================
;
; Por que existe: o contador de inatividade da Roblox e alimentado por
; ENTRADA DE VERDADE. Script rodando DENTRO do jogo mexe o personagem, mas nao
; toca nesse contador. Isto aqui toca.
;
; Como usar:
;   1. instale o AutoHotkey v2 (https://www.autohotkey.com/)
;   2. clique duas vezes neste arquivo
;   3. deixe rodando junto com o OBS
;
; As teclas enviadas sao "," e ".", que no Roblox giram a camera e nada mais:
; nao andam, nao pulam, nao clicam em botao de interface. O giro e desfeito na
; sequencia, entao o enquadramento da live volta ao lugar.
;
; So cutuca quando a janela do Roblox esta em foco - assim o script nunca rouba
; o teclado de quem estiver usando o PC para outra coisa.

#Requires AutoHotkey v2.0
#SingleInstance Force

INTERVALO_MS := 120000          ; 2 minutos; a Roblox derruba em ~20
JANELA := "ahk_exe RobloxPlayerBeta.exe"

Cutucar() {
    global JANELA
    if !WinExist(JANELA)
        return
    if !WinActive(JANELA)
        return
    Send("{,}")
    Sleep(120)
    Send("{.}")
}

SetTimer(Cutucar, INTERVALO_MS)
Cutucar()

; Ctrl+Alt+P encerra, para quando voce quiser usar o PC sem o script rodando.
^!p::ExitApp()
