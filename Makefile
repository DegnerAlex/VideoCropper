# Video Cutter — build and release automation

APP_NAME      := Video Cutter
APP_ID        := me.ergofox.videocropper

# Version from the Tauri config.
VERSION       := $(shell sed -n 's/.*"version": "\(.*\)".*/\1/p' videocropper/src-tauri/tauri.conf.json | head -1)
TAG           := v$(VERSION)

# AppImage artifact produced by the bundler.
APPIMAGE      := videocropper/src-tauri/target/release/bundle/appimage/$(APP_NAME)_$(VERSION)_amd64.AppImage

GH            ?= gh

.PHONY: appimage release upload clean clean-docker help

help:
	@echo "Targets:"
	@echo "  appimage   - build the Linux AppImage (sidecars + frontend + tauri build)"
	@echo "  release    - create a GitHub release for v$(VERSION) with gh"
	@echo "  upload     - upload the built AppImage to the release with gh"
	@echo "  clean      - remove build artifacts and temp files"
	@echo "  clean-docker - also stop containers and remove the dev images cache dirs"

# Build the AppImage inside the dev container (FFmpeg sidecars prepared first,
# then the frontend build and the Tauri bundle). APPIMAGE_EXTRACT_AND_RUN=1 is
# already set in the compose service, so FUSE is not required.
appimage:
	docker compose run --rm --no-deps -T videocropper bash -c "\
	    pnpm install && \
	    pnpm run build && \
	    pnpm run sidecars && \
	    cargo tauri build --bundles appimage"
	@ls -lh $(APPIMAGE)

# Create a GitHub release. GH_TOKEN must be authenticated; the tag must exist
# in the repository (push it first: git tag $(TAG) && git push origin $(TAG)).
release: appimage
	$(GH) release create "$(TAG)" "$(APPIMAGE)" \
	    --title "$(APP_NAME) $(TAG)" \
	    --generate-notes

# Upload (or replace) the AppImage on an existing release.
upload: appimage
	$(GH) release upload "$(TAG)" "$(APPIMAGE)" --clobber

# Remove build artifacts, temp files and test directories.
clean:
	rm -rf videocropper/dist
	rm -rf videocropper/src-tauri/target
	rm -rf videocropper/.tmp-test
	rm -rf videocropper/node_modules/.vite
	find . -name "*.tmp" -delete 2>/dev/null || true

# Additional Docker cleanup: stop dev containers, remove run containers.
clean-docker: clean
	docker compose down --remove-orphans || true
	docker rm -f $$(docker ps -aq --filter "name=videocropper") 2>/dev/null || true
