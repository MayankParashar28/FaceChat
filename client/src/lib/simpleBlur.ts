/**
 * Simple background blur using Canvas API
 * More reliable than MediaPipe, applies blur to entire video
 */

export interface SimpleBlurOptions {
  blurIntensity?: number; // 0-100, default 15
}

export class SimpleBackgroundBlur {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private outputStream: MediaStream | null = null;
  private processingVideo: HTMLVideoElement | null = null;
  private isProcessing: boolean = false;
  private animationFrameId: number | null = null;
  private options: Required<SimpleBlurOptions>;
  private originalStream: MediaStream | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = 33; // ~30 FPS

  constructor(options: SimpleBlurOptions = {}) {
    this.options = {
      blurIntensity: options.blurIntensity ?? 15,
    };
  }

  async initialize(originalStream: MediaStream): Promise<MediaStream> {
    this.originalStream = originalStream;
    const videoTrack = originalStream.getVideoTracks()[0];
    
    if (!videoTrack) {
      throw new Error("No video track in stream");
    }

    // Create a hidden video element to process frames
    this.processingVideo = document.createElement("video");
    this.processingVideo.autoplay = true;
    this.processingVideo.playsInline = true;
    this.processingVideo.muted = true;
    this.processingVideo.srcObject = originalStream;
    
    // Wait for video to be ready
    await new Promise<void>((resolve, reject) => {
      if (!this.processingVideo) {
        reject(new Error("Video element not created"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Video loading timeout"));
      }, 10000);

      this.processingVideo.onloadedmetadata = () => {
        if (this.processingVideo) {
          if (this.processingVideo.videoWidth > 0 && this.processingVideo.videoHeight > 0) {
            this.processingVideo.play()
              .then(() => {
                clearTimeout(timeout);
                resolve();
              })
              .catch((err) => {
                clearTimeout(timeout);
                reject(err);
              });
          } else {
            clearTimeout(timeout);
            reject(new Error("Invalid video dimensions"));
          }
        }
      };

      this.processingVideo.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Video element error"));
      };
    });

    // Validate video dimensions
    if (!this.processingVideo || 
        !this.processingVideo.videoWidth || 
        !this.processingVideo.videoHeight ||
        this.processingVideo.videoWidth <= 0 ||
        this.processingVideo.videoHeight <= 0) {
      throw new Error("Invalid video dimensions");
    }

    // Create canvas for processing
    this.canvas = document.createElement("canvas");
    const width = Math.max(1, this.processingVideo.videoWidth);
    const height = Math.max(1, this.processingVideo.videoHeight);
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    
    if (!this.ctx) {
      throw new Error("Failed to get canvas context");
    }

    // Start processing frames
    this.isProcessing = true;
    this.lastFrameTime = performance.now();
    this.startFrameProcessing();

    // Create output stream from canvas
    this.outputStream = this.canvas.captureStream(30); // 30 FPS
    
    // Copy audio tracks from original stream
    const audioTracks = originalStream.getAudioTracks();
    audioTracks.forEach(track => {
      this.outputStream?.addTrack(track);
    });

    return this.outputStream;
  }

  private startFrameProcessing() {
    const processFrame = (currentTime: number) => {
      if (!this.isProcessing || !this.processingVideo || !this.ctx || !this.canvas) {
        if (this.isProcessing) {
          this.animationFrameId = requestAnimationFrame(processFrame);
        }
        return;
      }

      try {
        // Throttle to ~30 FPS
        const timeSinceLastFrame = currentTime - this.lastFrameTime;
        
        if (timeSinceLastFrame >= this.frameInterval) {
          // Only process if video is ready
          if (this.processingVideo.readyState >= this.processingVideo.HAVE_METADATA &&
              this.processingVideo.videoWidth > 0 &&
              this.processingVideo.videoHeight > 0) {
            
            // Update canvas size if needed
            if (this.canvas.width !== this.processingVideo.videoWidth ||
                this.canvas.height !== this.processingVideo.videoHeight) {
              this.canvas.width = this.processingVideo.videoWidth;
              this.canvas.height = this.processingVideo.videoHeight;
            }

            // Apply blur filter and draw
            this.ctx.filter = `blur(${this.options.blurIntensity}px)`;
            this.ctx.drawImage(
              this.processingVideo,
              0,
              0,
              this.canvas.width,
              this.canvas.height
            );
            
            // Reset filter for next frame
            this.ctx.filter = 'none';
            
            this.lastFrameTime = currentTime;
          }
        }
      } catch (error) {
        console.error("Error processing frame:", error);
      }

      if (this.isProcessing) {
        this.animationFrameId = requestAnimationFrame(processFrame);
      }
    };

    this.animationFrameId = requestAnimationFrame(processFrame);
  }

  updateBlurIntensity(intensity: number) {
    this.options.blurIntensity = Math.max(0, Math.min(100, intensity));
  }

  async stop() {
    this.isProcessing = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop only the canvas-generated video tracks (not original stream tracks)
    if (this.outputStream) {
      this.outputStream.getTracks().forEach((track) => {
        if (track.kind === "video") {
          // Only stop canvas tracks, not original stream tracks
          try {
            // Canvas tracks typically have specific labels or are from canvas stream
            if (track.label.includes('canvas') || track.readyState === 'ended') {
              track.stop();
            }
          } catch (error) {
            console.error("Error stopping video track:", error);
          }
        }
      });
      this.outputStream = null;
    }

    // Clean up video element (but don't stop original stream)
    if (this.processingVideo) {
      try {
        this.processingVideo.pause();
        this.processingVideo.srcObject = null;
      } catch (error) {
        console.error("Error cleaning up video element:", error);
      }
      this.processingVideo = null;
    }

    // Clear canvas but keep original stream reference
    this.canvas = null;
    this.ctx = null;
    // Don't null originalStream - it might still be needed
  }
}

