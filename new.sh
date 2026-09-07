#!/usr/bin/env bash
set -e

# ====================================================
# 请在这里填入你的 Tailscale Auth Key
# ====================================================
TS_AUTHKEY="tskey-auth-kXXXXX-XXXXXX"

echo ">>> 1. 禁用原有的 debian.sources 并写入清华源..."
mkdir -p /etc/apt/sources.list.d
if [ -f /etc/apt/sources.list.d/debian.sources ]; then
    mv /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.sources.bak 2>/dev/null || true
fi

# 获取当前代号（Debian 12 为 bookworm，Debian 13 为 trixie）
CODENAME=$(grep VERSION_CODENAME /etc/os-release | cut -d= -f2)
[ -z "$CODENAME" ] && CODENAME="trixie"

cat << EOF > /etc/apt/sources.list
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ ${CODENAME} main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ ${CODENAME}-updates main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian-security ${CODENAME}-security main contrib non-free non-free-firmware
EOF

echo ">>> 2. 更新系统并安装基础网络工具..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates apt-transport-https iptables

echo ">>> 3. 安装 Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh

systemctl enable --now tailscaled

echo ">>> 4. 正在自动登录加入虚拟局域网..."
tailscale up --authkey="tskey-auth-kv1foqx8Hp11CNTRL-yC5BrgHEHtFVes2iKKeZsFHVvLkZZV94" --accept-routes --reset

echo "=========================================="
echo "执行完毕！本机 Tailscale 内网 IP 为："
tailscale ip -4
echo "=========================================="