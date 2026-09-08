#!/usr/bin/env bash
set -euo pipefail
: "${FAIZAN_LOG_DIR:=/var/log/faizan-monitor}"
: "${FAIZAN_REPORT_DIR:=/var/lib/faizan-monitor/reports}"
: "${FAIZAN_EXPORT_DIR:=/var/lib/faizan-monitor/exports}"
: "${FAIZAN_TEMP_DIR:=/var/lib/faizan-monitor/tmp}"
find "$FAIZAN_REPORT_DIR" -xdev -type f -mtime +90 -delete
find "$FAIZAN_EXPORT_DIR" -xdev -type f -mtime +30 -delete
find "$FAIZAN_TEMP_DIR" -xdev -type f -mtime +1 -delete
find "$FAIZAN_LOG_DIR" -xdev -type f -name '*.gz' -mtime +30 -delete
