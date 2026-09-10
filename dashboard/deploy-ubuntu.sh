#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

repo_url="${1:-https://github.com/devfaizanarshad/Faizan_Job_Tracking_System.git}"
branch="${2:-main}"
app_base=/opt/faizan-dashboard
config_dir=/etc/faizan-dashboard
env_file=${config_dir}/dashboard.env
state_dir=/var/lib/faizan-dashboard
log_dir=/var/log/faizan-dashboard
access_file=/root/faizan-dashboard-access.txt
database=faizan_employer_intelligence
dashboard_user=faizan-dashboard
database_user=faizan_dashboard

node_version=$(node --version)
npm_version=$(npm --version)
if [[ ${node_version} != v24.18.0 || ${npm_version} != 11.16.0 ]]; then
  echo "Expected Node v24.18.0 and npm 11.16.0; found ${node_version} and ${npm_version}." >&2
  exit 1
fi

if ! getent group "${dashboard_user}" >/dev/null; then
  groupadd --system "${dashboard_user}"
fi
if ! id "${dashboard_user}" >/dev/null 2>&1; then
  useradd --system --gid "${dashboard_user}" --home-dir "${state_dir}" --create-home --shell /usr/sbin/nologin "${dashboard_user}"
fi

install -d -o root -g "${dashboard_user}" -m 0750 "${app_base}" "${app_base}/releases" "${config_dir}"
install -d -o "${dashboard_user}" -g "${dashboard_user}" -m 0750 "${state_dir}" "${log_dir}"

if [[ ! -f ${env_file} ]]; then
  database_password=$(openssl rand -hex 24)
  dashboard_password=$(openssl rand -hex 24)
  umask 0027
  cat >"${env_file}" <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
TZ=Europe/Berlin
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=${database}
PGUSER=${database_user}
PGPASSWORD=${database_password}
PGCONNECT_TIMEOUT_MS=5000
DASHBOARD_USERNAME=faizan
DASHBOARD_PASSWORD=${dashboard_password}
EOF
  chown root:"${dashboard_user}" "${env_file}"
  chmod 0640 "${env_file}"
  umask 0077
  cat >"${access_file}" <<EOF
Dashboard username: faizan
Dashboard password: ${dashboard_password}
Local URL after opening the SSH tunnel: http://127.0.0.1:3000
EOF
  chmod 0600 "${access_file}"
fi

database_password=$(sed -n 's/^PGPASSWORD=//p' "${env_file}")
if [[ -z ${database_password} ]]; then
  echo "PGPASSWORD is missing from ${env_file}." >&2
  exit 1
fi

if ! sudo -u postgres psql -X -Atqc "SELECT 1 FROM pg_roles WHERE rolname='${database_user}'" | grep -qx 1; then
  sudo -u postgres createuser --login --no-createdb --no-createrole --no-superuser "${database_user}"
fi
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "ALTER ROLE ${database_user} PASSWORD '${database_password}'" >/dev/null
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c "ALTER ROLE ${database_user} SET default_transaction_read_only=on" >/dev/null
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "${database}" <<SQL >/dev/null
GRANT CONNECT ON DATABASE ${database} TO ${database_user};
GRANT USAGE ON SCHEMA public TO ${database_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${database_user};
ALTER DEFAULT PRIVILEGES FOR ROLE jobintel IN SCHEMA public GRANT SELECT ON TABLES TO ${database_user};
SQL

commit=$(git ls-remote "${repo_url}" "refs/heads/${branch}" | awk '{print $1}')
if [[ -z ${commit} ]]; then
  echo "Could not resolve ${branch} from ${repo_url}." >&2
  exit 1
fi
release="${app_base}/releases/${commit}"
partial="${release}.partial"

if [[ ! -d ${release} ]]; then
  rm -rf -- "${partial}"
  git clone --quiet --depth 1 --branch "${branch}" "${repo_url}" "${partial}"
  chown -R "${dashboard_user}:${dashboard_user}" "${partial}"
  sudo -u "${dashboard_user}" env HOME="${state_dir}" bash -c "set -a; source '${env_file}'; cd '${partial}/dashboard'; npm ci --include=dev --no-audit --no-fund; npm run build; npm prune --omit=dev --no-audit --no-fund"
  mv "${partial}" "${release}"
  chown -R root:"${dashboard_user}" "${release}"
fi

ln -sfn "${release}" "${app_base}/.current.new"
mv -Tf "${app_base}/.current.new" "${app_base}/current"
install -o root -g root -m 0644 "${release}/dashboard/faizan-dashboard.service" /etc/systemd/system/faizan-dashboard.service
systemctl daemon-reload
systemctl enable --now faizan-dashboard.service

sudo -u "${dashboard_user}" env PGPASSWORD="${database_password}" psql -X -h 127.0.0.1 -U "${database_user}" -d "${database}" -Atqc "SELECT current_setting('transaction_read_only'),has_table_privilege(current_user,'public.opportunities','SELECT'),has_table_privilege(current_user,'public.opportunities','INSERT')" | grep -qx 'on|t|f'
for attempt in {1..20}; do
  if curl --fail --silent --user "$(sed -n 's/^DASHBOARD_USERNAME=//p' "${env_file}"):$(sed -n 's/^DASHBOARD_PASSWORD=//p' "${env_file}")" http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  if [[ ${attempt} -eq 20 ]]; then
    echo "Dashboard service did not become ready." >&2
    journalctl -u faizan-dashboard.service -n 30 --no-pager >&2
    exit 1
  fi
  sleep 1
done

echo "Dashboard deployed at commit ${commit}."
echo "Service: $(systemctl is-active faizan-dashboard.service)"
echo "Credentials: ${access_file} (root-only)"
