#!/usr/bin/env bash
# =====================================================================
# ANTI-INATIVIDADE - Linux (xdotool)
# =====================================================================
#
# Mesma ideia da versao Windows: entrada de verdade, vinda do sistema, e a
# unica coisa que realmente zera o contador de inatividade da Roblox.
#
# Requisitos: xdotool (X11). Em Wayland, o xdotool nao alcanca outras janelas —
# use uma sessao X11 ou `ydotool` com o daemon configurado.
#
#   sudo apt install xdotool
#   chmod +x anti-afk-linux.sh
#   ./anti-afk-linux.sh

set -euo pipefail

INTERVALO="${INTERVALO:-120}"          # segundos entre cutucadas
JANELA="${JANELA:-Roblox}"             # trecho do titulo da janela

echo "anti-afk: cutucando a janela \"$JANELA\" a cada ${INTERVALO}s (Ctrl+C para sair)"

while true; do
  # `|| true` porque a janela pode nao existir no momento da varredura, e isso
  # nao e motivo para o laco morrer: o Roblox pode estar reiniciando.
  ids=$(xdotool search --name "$JANELA" 2>/dev/null || true)

  if [ -n "$ids" ]; then
    for id in $ids; do
      # "," e "." giram a camera no Roblox e nao fazem mais nada. O par
      # ida-e-volta devolve o enquadramento ao ponto de partida.
      xdotool key --window "$id" comma 2>/dev/null || true
      sleep 0.15
      xdotool key --window "$id" period 2>/dev/null || true
    done
  else
    echo "anti-afk: janela \"$JANELA\" nao encontrada; tentando de novo em ${INTERVALO}s"
  fi

  sleep "$INTERVALO"
done
