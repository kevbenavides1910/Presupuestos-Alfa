# Server monitoring for recurring hangs

This project includes a lightweight watchdog script to capture diagnostics when the app stops responding.

## Files

- `scripts/vps-health-monitor.sh`: pings `/login` and `/api/auth/session` every run.
- `docker-compose.prod.yml`: includes an app `healthcheck` for `/login`.

## 1) Deploy the latest code on the VPS

```bash
cd ~/Presupuestos-Alfa
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 2) Make watchdog executable

```bash
cd ~/Presupuestos-Alfa
chmod +x scripts/vps-health-monitor.sh
```

## 3) Test one manual run

```bash
cd ~/Presupuestos-Alfa
./scripts/vps-health-monitor.sh
```

This writes daily health lines to:

- `/var/log/presupuestos-alfa/health-YYYY-MM-DD.log`

If an endpoint fails or times out, it also writes a full snapshot:

- `/var/log/presupuestos-alfa/snapshot-YYYYMMDDTHHMMSSZ.log`

## 4) Run every minute with cron

Edit crontab:

```bash
crontab -e
```

Add this line:

```cron
* * * * * cd /root/Presupuestos-Alfa && /root/Presupuestos-Alfa/scripts/vps-health-monitor.sh
```

If your project path is different, update the path in the cron line.

## 5) Inspect evidence after a failure

```bash
ls -lah /var/log/presupuestos-alfa
tail -n 200 /var/log/presupuestos-alfa/health-$(date -u +%F).log
```

Open the latest snapshot file and check:

- OOM messages (`Killed process`, `Out of memory`)
- docker stats at failure time
- app/db log tail around the event

