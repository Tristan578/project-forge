.PHONY: dev build-engine copy-pkg web-dev clean

# Development: build engine, copy to web, start dev server
dev: build-engine copy-pkg web-dev

# Build the Rust engine to WASM
build-engine:
	cd engine && wasm-pack build --target web --out-dir pkg

# Copy WASM package to Next.js public directory
copy-pkg:
	rm -rf web/public/engine-pkg
	mkdir -p web/public/engine-pkg
	cp -r engine/pkg/* web/public/engine-pkg/

# Start Next.js development server
web-dev:
	cd web && npm run dev

# Build engine in release mode
build-engine-release:
	cd engine && wasm-pack build --target web --release --out-dir pkg

# Clean build artifacts
clean:
	rm -rf engine/pkg
	rm -rf engine/target
	rm -rf web/public/engine-pkg
	rm -rf web/.next
