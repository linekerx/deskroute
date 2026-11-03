#!/bin/sh
# Установка DeskRoute для текущего пользователя: ~/.local/share/deskroute + ярлык в меню
set -e
SRC="$(dirname "$(readlink -f "$0")")"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/deskroute"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DEST" "$APPS" "$HOME/.local/bin"
if [ "$SRC" != "$DEST" ]; then rm -rf "$DEST"; cp -a "$SRC" "$DEST"; fi
chmod +x "$DEST/deskroute" "$DEST/resources/core/xray" 2>/dev/null || true
ln -sf "$DEST/deskroute" "$HOME/.local/bin/deskroute"
cat > "$APPS/deskroute.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=DeskRoute
Comment=VPN-клиент для подписок Xray
Exec="$DEST/deskroute" %u
Icon=$DEST/deskroute.png
Terminal=false
Categories=Network;
MimeType=x-scheme-handler/deskroute;
StartupWMClass=DeskRoute
DESK
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
command -v xdg-mime >/dev/null && xdg-mime default deskroute.desktop x-scheme-handler/deskroute || true
echo "DeskRoute установлен: $DEST"
echo "Запуск: из меню приложений или командой deskroute"
