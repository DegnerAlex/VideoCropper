# Video Cropper — build and release automation

APP_NAME      := Video\ Cropper
APP_ID        := me.ergofox.videocropper

# Version from the Tauri config.
VERSION       := $(shell sed -n 's/.*"version": "\(.*\)".*/\1/p' videocropper/src-tauri/tauri.conf.json | head -1)
TAG           := v$(VERSION)

# AppImage artifact produced by the bundler.
APPIMAGE      := videocropper/src-tauri/target/release/bundle/appimage/$(APP_NAME)_$(VERSION)_amd64.AppImage

GH            ?= gh

.PHONY: all appimage release upload clean clean-docker clean-all help

help:
	@echo "Targets:"
	@echo "  all        - full release pipeline: AppImage + GitHub release + upload"
	@echo "  appimage   - build the Linux AppImage (sidecars + frontend + tauri build)"
	@echo "  release    - create a GitHub release for v$(VERSION) with gh"
	@echo "  upload     - upload the built AppImage to the release with gh"
	@echo "  clean      - remove build artifacts and temp files"
	@echo "  clean-docker - remove containers, networks, project images and volumes"
	@echo "  clean-all    - full wipe: clean-docker + assets (sidecars, gen) + docker prune"

# Full release pipeline: build the AppImage, create the GitHub release for the
# current version (unless it already exists) and upload the artifact to it.
# The tag must already exist in the repository:
#   git tag $(TAG) && git push origin $(TAG)
all: appimage
	@$(GH) release view "$(TAG)" >/dev/null 2>&1 || $(MAKE) --no-print-directory release
	@$(MAKE) --no-print-directory upload

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
release:
	$(GH) release create "$(TAG)" "$(APPIMAGE)" \
	    --title "$(APP_NAME) $(TAG)" \
	    --generate-notes

# Upload (or replace) the AppImage on an existing release.
upload: 
	$(GH) release upload "$(TAG)" "$(APPIMAGE)" --clobber

# Remove build artifacts, temp files and test directories.
clean:
	rm -rf videocropper/dist
	rm -rf videocropper/src-tauri/target
	rm -rf videocropper/.tmp-test
	rm -rf videocropper/node_modules/.vite
	find . -name "*.tmp" -delete 2>/dev/null || true

# Docker cleanup: containers, networks, project images and volumes
# (including the cargo-registry build cache — the next build will
# re-download dependencies).
clean-docker: clean
	@echo ">> removing containers, networks and volumes"
	docker compose down --remove-orphans --volumes 2>/dev/null || true
	docker rm -f $$(docker ps -aq --filter "name=videocropper") 2>/dev/null || true
	docker volume rm $$(docker volume ls -q --filter "name=videocropper") 2>/dev/null || true
	@echo ">> removing project images"
	docker rmi -f $$(docker images -q "videocropper-*") 2>/dev/null || true

# Full wipe: everything from clean-docker plus ALL remaining docker
# resources of the builder and every regenerable asset — tauri codegen,
# everything is rebuilt by `make appimage`). Affects the whole docker host,
# not just this project.
clean-all: clean clean-docker
	@echo ">> full docker system prune (all unused images + build cache)"
	docker system prune -af 2>/dev/null || true
	@echo ">> disk usage after cleanup:"
	@docker system df
