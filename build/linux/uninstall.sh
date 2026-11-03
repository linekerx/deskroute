#!/bin/sh
D="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -rf "$D/deskroute" "$D/applications/deskroute.desktop" "$HOME/.local/bin/deskroute"
echo "DeskRoute удалён. Настройки остались в ~/.config/DeskRoute"
