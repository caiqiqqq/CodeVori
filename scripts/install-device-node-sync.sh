#!/usr/bin/env bash
# Run as root on the existing download server after copying scripts/ there.
set -euo pipefail
if [[ "$(id -u)" != 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null
command -v systemctl >/dev/null
# 不替换主程序镜像脚本；客户端复用代码副本，拥有独立用户、目录及 timer。
if ! id codevori-node-update >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin codevori-node-update
fi
install -d -m 0755 /opt/codevori-node-update
install -m 0644 "$script_dir/sync-device-node.py" "$script_dir/sync-github-releases.py" /opt/codevori-node-update/
install -d -o codevori-node-update -g codevori-node-update -m 0755 /srv/codevori-node
# 现有手工发布目录归新同步用户管理；文件与原下载路由保留。
chown -R codevori-node-update:codevori-node-update /srv/codevori-node
install -m 0644 "$script_dir/release-mirror/codevori-node-sync.service" "$script_dir/release-mirror/codevori-node-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now codevori-node-sync.timer
systemctl start --no-block codevori-node-sync.service
echo "Client release sync installed; inspect: journalctl -u codevori-node-sync.service"
