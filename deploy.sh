#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
publish_dir="/var/www/offerforge"

install -d -m 755 "$publish_dir"
install -m 644 "$project_dir/index.html" "$publish_dir/index.html"
install -m 644 "$project_dir/styles.css" "$publish_dir/styles.css"
install -m 644 "$project_dir/app.js" "$publish_dir/app.js"

nginx -t
systemctl reload nginx

echo "Published OfferForge to $publish_dir"
