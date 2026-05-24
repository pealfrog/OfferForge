#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
publish_dir="/var/www/offerforge"

install -d -m 755 "$publish_dir"
install -d -m 755 "$publish_dir/vendor/pdfjs"
install -m 644 "$project_dir/index.html" "$publish_dir/index.html"
install -m 644 "$project_dir/styles.css" "$publish_dir/styles.css"
install -m 644 "$project_dir/app.js" "$publish_dir/app.js"
install -m 644 "$project_dir/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs" "$publish_dir/vendor/pdfjs/pdf.min.mjs"
install -m 644 "$project_dir/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs" "$publish_dir/vendor/pdfjs/pdf.worker.min.mjs"

nginx -t
systemctl reload nginx

echo "Published OfferForge to $publish_dir"
