#!/bin/bash
# Simple architecture check
if grep -r "web_sys" engine/src --exclude-dir=bridge; then
    echo "VIOLATION: web_sys found outside of bridge module!"
    exit 1
fi
echo "Architecture check passed."
