<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const { session } = useAuth();
const { t } = useI18n();
const router = useRouter();
const route = useRoute();

// >>> View mode
const view = ref<"upload" | "gallery">("upload");

// >>> Upload state
const isDragging = ref(false);
const uploading = ref(false);
const uploadError = ref("");
const lastLink = ref("");
const lastCopied = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

// >>> Gallery state
interface UploadedImage {
  id: string;
  filename: string;
  url: string;
  size: number;
  mime: string;
  created_at: number;
  expires_at: number | null;
}
const images = ref<UploadedImage[]>([]);
const galleryLoad = ref(false);
const deleteId = ref<string | null>(null);

const isGuest = computed(() => !session.value);
const imageUrl = (id: string) => `https://i.shyboti.de/${id}`;

// >>> Upload from URL
const urlInput = ref("");
const urlUploading = ref(false);
const urlError = ref("");

async function uploadFromUrl() {
  const v = urlInput.value.trim();
  if (!v) return;
  urlUploading.value = true;
  urlError.value = "";
  uploadError.value = "";
  try {
    const res = await fetch(v);
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/"))
      throw new Error("URL does not point to an image");
    const blob = await res.blob();
    const name = v.split("/").pop()?.split("?")[0] ?? "image";
    await uploadFiles([new File([blob], name, { type: ct })]);
    urlInput.value = "";
  } catch (e: any) {
    urlError.value = e.message ?? "Failed to fetch image";
  }
  urlUploading.value = false;
}

// >>> Crop state
const cropOpen = ref(false);
const cropCanvas = ref<HTMLCanvasElement | null>(null);
const cropImg = ref<HTMLImageElement | null>(null);
const cropStart = ref({ x: 0, y: 0 });
const cropEnd = ref({ x: 0, y: 0 });
const cropDragging = ref(false);
const cropApplying = ref(false);

function openCrop() {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    cropImg.value = img;
    cropOpen.value = true;
  };
  img.src = lastLink.value;
}

function cropMouseDown(e: MouseEvent) {
  const canvas = cropCanvas.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  cropStart.value = {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
  cropEnd.value = { ...cropStart.value };
  cropDragging.value = true;
  drawCrop();
}

function cropMouseMove(e: MouseEvent) {
  if (!cropDragging.value) return;
  const canvas = cropCanvas.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  cropEnd.value = {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
  drawCrop();
}

function cropMouseUp() {
  cropDragging.value = false;
}

function drawCrop() {
  const canvas = cropCanvas.value;
  const img = cropImg.value;
  if (!canvas || !img) return;
  const ctx = canvas.getContext("2d")!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  const x1 = Math.min(cropStart.value.x, cropEnd.value.x);
  const y1 = Math.min(cropStart.value.y, cropEnd.value.y);
  const w = Math.abs(cropEnd.value.x - cropStart.value.x);
  const h = Math.abs(cropEnd.value.y - cropStart.value.y);
  if (w > 2 && h > 2) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, x1, y1, w, h, x1, y1, w, h);
    ctx.strokeStyle = "#9d6cff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, w, h);
  }
}

// >>> Draw image on canvas when crop modal opens
watch(cropOpen, async (val) => {
  if (!val) return;
  await nextTick();
  drawCrop();
});

async function applyCrop() {
  const canvas = cropCanvas.value;
  const img = cropImg.value;
  if (!canvas || !img) return;
  const x1 = Math.min(cropStart.value.x, cropEnd.value.x);
  const y1 = Math.min(cropStart.value.y, cropEnd.value.y);
  const w = Math.abs(cropEnd.value.x - cropStart.value.x);
  const h = Math.abs(cropEnd.value.y - cropStart.value.y);
  if (w < 2 || h < 2) return;
  cropApplying.value = true;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(img, x1, y1, w, h, 0, 0, w, h);
  out.toBlob(
    async (blob) => {
      if (!blob) {
        cropApplying.value = false;
        return;
      }
      cropOpen.value = false;
      lastLink.value = "";
      await uploadFiles([
        new File([blob], "cropped.jpg", { type: "image/jpeg" }),
      ]);
      cropApplying.value = false;
    },
    "image/jpeg",
    0.92,
  );
}

// >>> If ?gallery=1 was passed from UploadsView, open gallery directly
onMounted(() => {
  if (route.query.gallery) switchView("gallery");
});

// >>> Drag events
function onDragEnter(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}
function onDragLeave(e: DragEvent) {
  const rel = e.relatedTarget as HTMLElement | null;
  if (!rel || !(e.currentTarget as HTMLElement).contains(rel))
    isDragging.value = false;
}
function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function isAcceptedFile(f: File) {
  return f.type.startsWith("image/") || f.type.startsWith("video/");
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []).filter(isAcceptedFile);
  if (files.length) await uploadFiles(files);
}

function onFileInputChange(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []).filter(
    isAcceptedFile,
  );
  if (files.length) uploadFiles(files);
}

// >>> Client-side image compression using Canvas
// >>> Reduces large images to at most maxMB at quality 0.82 before sending.
// >>> GIFs are not compressed (Canvas loses animation).
async function compressImage(file: File, maxMB = 3): Promise<Blob> {
  const maxBytes = maxMB * 1024 * 1024;
  // >>> Don't compress GIFs - Canvas destroys animation
  if (file.type === "image/gif" || file.size <= maxBytes) return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // >>> Scale down if image is very large (> 4K in either dimension)
      const MAX_DIM = 3840;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // >>> Try JPEG at decreasing quality until under maxBytes
      let quality = 0.82;
      const tryEncode = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Canvas encode failed"));
              return;
            }
            if (blob.size <= maxBytes || quality < 0.25) {
              resolve(blob);
            } else {
              quality -= 0.12;
              tryEncode();
            }
          },
          "image/jpeg",
          quality,
        );
      };
      tryEncode();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    }; // fallback: upload original
    img.src = url;
  });
}

// >>> Video pre-compression: shrink videos over 50MB via canvas frame extraction (best-effort)
// >>> Full video transcoding isn't possible in-browser without ffmpeg.wasm.
// >>> We shrink images aggressively. Videos over 50MB are rejected with a clear message.
async function prepareFile(file: File): Promise<Blob | null> {
  const MAX = 50 * 1024 * 1024;
  if (file.type.startsWith("video/")) {
    // >>> Videos: try to shrink images only; full video transcode needs server-side ffmpeg
    // >>> If the file is under 50MB, upload as-is. Over 50MB, reject clearly.
    if (file.size > MAX) return null;
    return file;
  }
  // >>> Images: compress with Canvas
  if (file.type === "image/gif") return file; // GIFs lose animation in Canvas
  if (file.size <= 3 * 1024 * 1024) return file; // small enough, skip compression
  try {
    return await compressImage(file, 3);
  } catch {
    return file;
  }
}

async function uploadFiles(files: File[]) {
  uploading.value = true;
  uploadError.value = "";
  lastLink.value = "";
  try {
    for (const file of files) {
      // >>> Hard reject: not an accepted type
      if (!isAcceptedFile(file)) {
        uploadError.value = `${file.name} is not an accepted image or video`;
        continue;
      }

      // >>> Pre-compress / validate size before upload
      const blob = await prepareFile(file);
      if (!blob) {
        uploadError.value = `${file.name} exceeds 50 MB and cannot be compressed in-browser. Please compress it first.`;
        continue;
      }

      // >>> Hard server-side limit guard
      if (blob.size > 50 * 1024 * 1024) {
        uploadError.value = `${file.name} is too large (max 50 MB)`;
        continue;
      }

      const fd = new FormData();
      // >>> Use compressed/validated blob, keep original filename
      fd.append(
        "file",
        new File([blob], file.name, { type: blob.type || file.type }),
      );

      const headers: Record<string, string> = {};
      if (session.value)
        headers["Authorization"] = `Bearer ${session.value.token}`;

      const res = await fetch(`${API}/images/upload`, {
        method: "POST",
        headers,
        body: fd,
      });

      // >>> Always try to parse JSON - but handle plain-text 404/errors gracefully
      let data: any = {};
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { error: text || `Server error (${res.status})` };
      }

      if (!res.ok) {
        uploadError.value = data.error ?? `Upload failed (${res.status})`;
        continue;
      }

      lastLink.value = imageUrl(data.id);
      if (fileInputRef.value) fileInputRef.value.value = "";
    }
  } catch (e: any) {
    uploadError.value = e.message ?? "Upload failed";
  }
  uploading.value = false;
}

async function copyLink(url: string) {
  await navigator.clipboard.writeText(url).catch(() => { });
  lastCopied.value = true;
  setTimeout(() => (lastCopied.value = false), 1800);
}

// >>> Gallery
async function loadGallery() {
  galleryLoad.value = true;
  try {
    const headers: Record<string, string> = {};
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    const res = await fetch(`${API}/images/my`, { headers });
    if (res.ok) images.value = (await res.json()) as UploadedImage[];
  } catch { }
  galleryLoad.value = false;
}

async function deleteImage(id: string) {
  if (deleteId.value !== id) {
    deleteId.value = id;
    setTimeout(() => {
      if (deleteId.value === id) deleteId.value = null;
    }, 3000);
    return;
  }
  deleteId.value = null;
  try {
    const headers: Record<string, string> = {};
    if (session.value)
      headers["Authorization"] = `Bearer ${session.value.token}`;
    await fetch(`${API}/images/${id}`, { method: "DELETE", headers });
    images.value = images.value.filter((img) => img.id !== id);
  } catch { }
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function switchView(v: "upload" | "gallery") {
  view.value = v;
  if (v === "gallery") loadGallery();
}
</script>

<template>
  <div class="images-page">
    <!-- Gallery view -->
    <div v-if="view === 'gallery'" class="gallery-view">
      <div class="gallery-header">
        <button class="back-btn" @click="view = 'upload'">
          {{ t("images.back") }}
        </button>
        <div class="gallery-title">{{ t("images.your") }}</div>
        <span class="gallery-count" v-if="images.length">{{ images.length }} / 100</span>
      </div>
      <div v-if="galleryLoad" class="gallery-empty">
        {{ t("images.loading") }}
      </div>
      <div v-else-if="!images.length" class="gallery-empty">
        {{ t("images.empty") }}
      </div>
      <div v-else class="gallery-grid">
        <div v-for="img in images" :key="img.id" class="gallery-item">
          <a :href="imageUrl(img.id)" target="_blank" rel="noopener" class="gallery-thumb-wrap">
            <video v-if="img.mime?.startsWith('video/')" :src="imageUrl(img.id)" class="gallery-thumb" muted loop
              preload="metadata" />
            <img v-else :src="imageUrl(img.id)" :alt="img.filename" class="gallery-thumb" loading="lazy" />
          </a>
          <div class="gallery-item-info">
            <div class="gallery-item-name">{{ img.filename }}</div>
            <div class="gallery-item-meta">
              {{ fmtSize(img.size) }} · {{ fmtDate(img.created_at) }}
            </div>
            <div class="gallery-item-link">
              <code class="img-link-code">{{ imageUrl(img.id) }}</code>
              <button class="copy-btn-sm" @click="copyLink(imageUrl(img.id))">
                {{ t("images.copy") }}
              </button>
            </div>
          </div>
          <button class="delete-btn" :class="{ confirm: deleteId === img.id }" @click="deleteImage(img.id)">
            {{ deleteId === img.id ? "?" : "✕" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Upload view -->
    <div v-else class="upload-view">
      <!-- Guest warning -->
      <div v-if="isGuest" class="guest-banner">
        <span class="guest-icon">ⓘ</span>
        {{ t("images.guest_note") }}
      </div>

      <!-- Drop zone -->
      <div class="dropzone" :class="{ dragging: isDragging, has_link: !!lastLink }" @dragenter="onDragEnter"
        @dragleave="onDragLeave" @dragover="onDragOver" @drop="onDrop"
        @click="!uploading && !lastLink && fileInputRef?.click()">
        <input ref="fileInputRef" type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime,video/x-msvideo,video/mpeg" multiple
          class="file-input-hidden" @change="onFileInputChange" />

        <!-- Uploading state -->
        <div v-if="uploading" class="drop-state">
          <div class="upload-spinner"></div>
          <div class="drop-label">{{ t("images.uploading") }}</div>
        </div>

        <!-- Link result state -->
        <div v-else-if="lastLink" class="drop-state link-state" @click.stop>
          <img :src="lastLink" class="upload-preview" alt="uploaded" />
          <div class="link-bar">
            <span class="link-label">{{ t("images.link") }}</span>
            <code class="link-code">{{ lastLink }}</code>
            <button class="crop-btn" @click.stop="openCrop()">✂ Crop</button>
            <button class="copy-btn" @click.stop="copyLink(lastLink)">
              {{ lastCopied ? t("images.copied") : t("images.copy") }}
            </button>
          </div>
          <div class="drop-uploads-hint" @click.stop="
            lastLink = '';
          uploadError = '';
          ">
            {{ t("images.drop") }}
          </div>
        </div>

        <!-- Idle state -->
        <div v-else class="drop-state">
          <svg class="drop-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="10" width="56" height="44" rx="5" stroke="currentColor" stroke-width="2.5"
              stroke-dasharray="6 4" opacity="0.45" />
            <path d="M32 42V26" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            <path d="M24 34L32 26L40 34" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
              stroke-linejoin="round" />
            <circle cx="20" cy="24" r="3.5" stroke="currentColor" stroke-width="2" opacity="0.3" />
            <path d="M8 46L20 32L28 40L38 28L56 46" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" opacity="0.25" />
          </svg>
          <div class="drop-label">{{ t("images.drop") }}</div>
          <div class="drop-hint">
            PNG, JPG, GIF, WEBP, MP4, WEBM · max 50 MB
          </div>
        </div>

        <div v-if="uploadError" class="upload-error" @click.stop>
          {{ uploadError }}
        </div>
      </div>

      <!-- Upload from URL -->
      <div class="url-bar">
        <input v-model="urlInput" class="url-input" placeholder="Paste any image URL to upload it…"
          @keydown.enter="uploadFromUrl" :disabled="urlUploading" />
        <button class="url-go-btn" @click="uploadFromUrl" :disabled="urlUploading">
          {{ urlUploading ? "…" : "↑" }}
        </button>
      </div>
      <div v-if="urlError" class="url-error">{{ urlError }}</div>

      <!-- Bottom bar -->
      <div class="bottom-bar">
        <button class="your-btn" @click.stop="switchView('gallery')">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="your-icon">
            <rect x="1" y="1" width="6" height="6" rx="0.8" stroke="currentColor" stroke-width="1.4" />
            <rect x="9" y="1" width="6" height="6" rx="0.8" stroke="currentColor" stroke-width="1.4" />
            <rect x="1" y="9" width="6" height="6" rx="0.8" stroke="currentColor" stroke-width="1.4" />
            <rect x="9" y="9" width="6" height="6" rx="0.8" stroke="currentColor" stroke-width="1.4" />
          </svg>
          {{ t("images.your") }}
        </button>
        <span class="limit-hint">{{ t("images.limit") }}</span>
      </div>
    </div>
  </div>

  <!-- Crop modal -->
  <Teleport to="body">
    <div v-if="cropOpen" class="crop-backdrop" @click.self="cropOpen = false">
      <div class="crop-modal">
        <div class="crop-header">
          <span class="crop-title">✂ Crop Image</span>
          <button class="crop-close" @click="cropOpen = false">✕</button>
        </div>
        <div class="crop-hint">Click and drag to select crop area</div>
        <canvas ref="cropCanvas" class="crop-canvas" @mousedown="cropMouseDown" @mousemove="cropMouseMove"
          @mouseup="cropMouseUp" @mouseleave="cropMouseUp" />
        <div class="crop-actions">
          <button class="crop-cancel" @click="cropOpen = false">Cancel</button>
          <button class="crop-apply" :disabled="cropApplying" @click="applyCrop">
            {{ cropApplying ? "Applying…" : "Apply Crop" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.images-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.guest-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 11px;
  color: #888;
  background: rgba(229, 192, 123, 0.06);
  border: 1px solid rgba(229, 192, 123, 0.2);
  border-bottom: none;
  flex-shrink: 0;
}

.guest-icon {
  color: #e5c07b;
  font-size: 13px;
}

.upload-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dropzone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #111217;
  border: 2px dashed #2a2a30;
  cursor: pointer;
  position: relative;
  transition:
    border-color 0.2s,
    background 0.2s;
  overflow: hidden;
  min-height: 300px;
}

.dropzone:hover {
  border-color: #6f2bff44;
  background: #13121a;
}

.dropzone.dragging {
  border-color: #9d6cff;
  background: #0e0d16;
}

.dropzone.has_link {
  cursor: default;
  border-style: solid;
  border-color: #2a2a30;
}

.file-input-hidden {
  display: none;
}

.drop-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.drop-state.link-state {
  pointer-events: auto;
  gap: 16px;
  cursor: default;
}

.drop-icon {
  width: 72px;
  height: 72px;
  color: #444;
  transition: color 0.2s;
}

.dropzone.dragging .drop-icon {
  color: #9d6cff;
}

.drop-label {
  font-size: 15px;
  font-weight: 600;
  color: #666;
  text-align: center;
  transition: color 0.2s;
}

.dropzone.dragging .drop-label {
  color: #9d6cff;
}

.drop-hint {
  font-size: 12px;
  color: #383838;
}

.drop-uploads-hint {
  font-size: 11px;
  color: #444;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.15s;
}

.drop-uploads-hint:hover {
  color: #9d6cff;
}

.upload-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #2a2a30;
  border-top-color: #9d6cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.upload-preview {
  max-width: min(420px, 80vw);
  max-height: 260px;
  object-fit: contain;
  border: 1px solid #2a2a30;
}

.link-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #0d0d10;
  border: 1px solid #2a2a30;
  padding: 8px 12px;
  width: min(500px, 90vw);
}

.link-label {
  font-size: 10px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.link-code {
  flex: 1;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
  color: #9d6cff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid #6f2bff55;
  background: #6f2bff18;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.copy-btn:hover {
  background: #6f2bff30;
}

.upload-error {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: #f14949;
  background: rgba(241, 73, 73, 0.1);
  border: 1px solid #f1494944;
  padding: 7px 16px;
  white-space: nowrap;
  pointer-events: auto;
  max-width: 90vw;
  text-align: center;
}

.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #0d0d10;
  border-top: 1px solid #1e1e24;
  flex-shrink: 0;
}

.your-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.your-btn:hover {
  border-color: #9d6cff55;
  color: #9d6cff;
  background: rgba(111, 43, 255, 0.06);
}

.your-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.limit-hint {
  font-size: 10px;
  color: #383838;
}

.url-bar {
  display: flex;
  align-items: center;
  gap: 0;
  border-top: 1px solid #1e1e24;
  flex-shrink: 0;
}

.url-input {
  flex: 1;
  height: 34px;
  background: #0d0d10;
  border: none;
  border-right: 1px solid #1e1e24;
  color: #aaa;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 11px;
  padding: 0 12px;
  outline: none;
}

.url-input::placeholder {
  color: #333;
}

.url-input:focus {
  background: #111217;
}

.url-go-btn {
  width: 40px;
  height: 34px;
  border: none;
  background: #0d0d10;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.url-go-btn:hover {
  background: #6f2bff18;
  color: #9d6cff;
}

.gallery-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.gallery-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 14px;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
  margin-bottom: 16px;
}

.back-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.back-btn:hover {
  color: #e0e0e0;
  border-color: #444;
}

.gallery-title {
  font-size: 16px;
  font-weight: 700;
  color: #e0e0e0;
  flex: 1;
}

.gallery-count {
  font-size: 11px;
  color: #555;
}

.gallery-empty {
  color: #444;
  font-size: 13px;
  padding: 40px;
  text-align: center;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  overflow-y: auto;
  padding-bottom: 8px;
}

.gallery-item {
  position: relative;
  background: #141418;
  border: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 0.15s;
}

.gallery-item:hover {
  border-color: #3a3a44;
}

.gallery-thumb-wrap {
  display: block;
  aspect-ratio: 1/1;
  overflow: hidden;
  background: #0d0d10;
}

.gallery-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 0.15s;
}

.gallery-thumb-wrap:hover .gallery-thumb {
  opacity: 0.85;
}

.gallery-item-info {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.gallery-item-name {
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-item-meta {
  font-size: 10px;
  color: #444;
}

.gallery-item-link {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.img-link-code {
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 10px;
  color: #9d6cff;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn-sm {
  height: 20px;
  padding: 0 7px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s;
}

.copy-btn-sm:hover {
  background: #6f2bff18;
}

.delete-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: 1px solid #f1494944;
  background: #0d0d10cc;
  color: #f14949;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.15s,
    background 0.15s;
}

.gallery-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(241, 73, 73, 0.2);
}

.delete-btn.confirm {
  opacity: 1;
  border-color: #f14949;
  background: rgba(241, 73, 73, 0.2);
  font-weight: 700;
}

.crop-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #6f2bff44;
  background: transparent;
  color: #9d6cff;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s;
}

.crop-btn:hover {
  background: #6f2bff18;
}

.url-error {
  font-size: 11px;
  color: #f14949;
  padding: 4px 12px;
  background: rgba(241, 73, 73, 0.06);
  border-top: 1px solid rgba(241, 73, 73, 0.2);
  flex-shrink: 0;
}

.crop-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.crop-modal {
  background: #141418;
  border: 1px solid #2a2a30;
  display: flex;
  flex-direction: column;
  max-width: 90vw;
  max-height: 90vh;
}

.crop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #1e1e24;
  flex-shrink: 0;
}

.crop-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e0e0;
}

.crop-close {
  background: none;
  border: none;
  color: #666;
  font-size: 16px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crop-close:hover {
  color: #e0e0e0;
}

.crop-hint {
  font-size: 11px;
  color: #555;
  padding: 6px 14px;
  border-bottom: 1px solid #1e1e24;
  flex-shrink: 0;
}

.crop-canvas {
  max-width: 85vw;
  max-height: 70vh;
  object-fit: contain;
  cursor: crosshair;
  display: block;
}

.crop-actions {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #1e1e24;
  flex-shrink: 0;
  justify-content: flex-end;
}

.crop-cancel {
  height: 28px;
  padding: 0 14px;
  border: 1px solid #2a2a30;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.crop-cancel:hover {
  border-color: #3a3a44;
  color: #ccc;
}

.crop-apply {
  height: 28px;
  padding: 0 16px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}

.crop-apply:hover:not(:disabled) {
  background: #7f3fff;
}

.crop-apply:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
