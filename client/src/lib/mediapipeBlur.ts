import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export interface MediaPipeBlurOptions {
  modelSelection?: 0 | 1; // 0 for general, 1 for landscape
  blurIntensity?: number; // 0-100, default 15
}

export class MediaPipeBackgroundBlur {
  private selfieSegmentation: SelfieSegmentation | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private outputStream: MediaStream | null = null;
  private processingVideo: HTMLVideoElement | null = null;
  private isProcessing: boolean = false;
  private animationFrameId: number | null = null;
  private options: Required<MediaPipeBlurOptions>;
  private originalStream: MediaStream | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = 33; // ~30 FPS (33ms between frames)
  private isMediaPipeReady: boolean = false;
  private pendingFrame: boolean = false;

  constructor(options: MediaPipeBlurOptions = {}) {
    this.options = {
      modelSelection: options.modelSelection ?? 0,
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
    this.processingVideo.muted = true; // Mute to avoid feedback
    this.processingVideo.srcObject = originalStream;
    
    // Wait for video to be ready with proper dimensions
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
          // Ensure we have valid dimensions
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

      this.processingVideo.onerror = (err) => {
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

    // Create canvas for processing with validated dimensions
    this.canvas = document.createElement("canvas");
    const width = Math.max(1, this.processingVideo.videoWidth);
    const height = Math.max(1, this.processingVideo.videoHeight);
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    
    if (!this.ctx) {
      throw new Error("Failed to get canvas context");
    }

    // Initialize MediaPipe SelfieSegmentation
    this.selfieSegmentation = new SelfieSegmentation({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
      },
    });

    this.selfieSegmentation.setOptions({
      modelSelection: this.options.modelSelection,
    });

    // Process each frame with error handling
    this.selfieSegmentation.onResults((results) => {
      this.pendingFrame = false; // Mark that we're no longer waiting for results
      
      if (!this.isProcessing || !this.ctx || !this.canvas) {
        return;
      }
      try {
        this.processFrame(results);
      } catch (error) {
        console.error("Error processing frame:", error);
        // Fallback: draw original image if processing fails
        if (results?.image) {
          try {
            const width = results.image.width || this.canvas.width;
            const height = results.image.height || this.canvas.height;
            this.ctx.drawImage(results.image, 0, 0, width, height);
          } catch (drawError) {
            console.error("Error drawing fallback image:", drawError);
          }
        }
      }
    });

    // Wait for MediaPipe to be ready before processing
    // Add a small delay to ensure WASM is fully loaded
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        this.isMediaPipeReady = true;
        resolve();
      }, 500); // Give MediaPipe 500ms to initialize
    });

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
      if (!this.isProcessing || !this.processingVideo || !this.selfieSegmentation || !this.isMediaPipeReady) {
        if (this.isProcessing) {
          this.animationFrameId = requestAnimationFrame(processFrame);
        }
        return;
      }

      try {
        // Throttle frame processing to ~30 FPS
        const timeSinceLastFrame = currentTime - this.lastFrameTime;
        
        // Only process if enough time has passed and no pending frame
        if (timeSinceLastFrame >= this.frameInterval && !this.pendingFrame) {
          // Only process if video is ready and has valid dimensions
          if (this.processingVideo.readyState >= this.processingVideo.HAVE_METADATA &&
              this.processingVideo.videoWidth > 0 &&
              this.processingVideo.videoHeight > 0 &&
              this.processingVideo.videoWidth <= 4096 &&
              this.processingVideo.videoHeight <= 4096) { // Sanity check for max dimensions
            try {
              this.pendingFrame = true; // Mark that we're waiting for results
              this.lastFrameTime = currentTime;
              this.selfieSegmentation.send({ image: this.processingVideo });
            } catch (sendError) {
              this.pendingFrame = false;
              console.error("Error sending frame to MediaPipe:", sendError);
              // If MediaPipe fails, stop processing to prevent cascade of errors
              this.isProcessing = false;
            }
          }
        }
      } catch (error) {
        console.error("Error in frame processing loop:", error);
        this.pendingFrame = false;
      }

      if (this.isProcessing) {
        this.animationFrameId = requestAnimationFrame(processFrame);
      }
    };

    this.animationFrameId = requestAnimationFrame(processFrame);
  }

  private processFrame(results: any) {
    if (!this.ctx || !this.canvas || !results) {
      return;
    }

    const { image, segmentationMask } = results;

    // Validate image exists and has valid dimensions
    if (!image || 
        typeof image.width !== 'number' || 
        typeof image.height !== 'number' ||
        image.width <= 0 || 
        image.height <= 0 ||
        !Number.isFinite(image.width) ||
        !Number.isFinite(image.height)) {
      console.warn("Invalid image dimensions in processFrame");
      return;
    }

    // Set canvas size to match video (with validation)
    const newWidth = Math.max(1, Math.floor(image.width));
    const newHeight = Math.max(1, Math.floor(image.height));
    
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (segmentationMask && 
        segmentationMask.width > 0 && 
        segmentationMask.height > 0) {
      try {
        // Step 1: Draw the blurred background
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = this.canvas.width;
        blurCanvas.height = this.canvas.height;
        const blurCtx = blurCanvas.getContext("2d");
        
        if (blurCtx) {
          // Draw original image and blur it
          blurCtx.drawImage(image, 0, 0, blurCanvas.width, blurCanvas.height);
          blurCtx.filter = `blur(${this.options.blurIntensity}px)`;
          blurCtx.drawImage(image, 0, 0, blurCanvas.width, blurCanvas.height);
          
          // Draw blurred background to main canvas
          this.ctx.drawImage(blurCanvas, 0, 0);
        }

        // Step 2: Draw the original person using the mask
        this.ctx.save();
        
        // Use the mask to cut out the person from the blurred background
        this.ctx.globalCompositeOperation = "destination-in";
        this.ctx.drawImage(segmentationMask, 0, 0, this.canvas.width, this.canvas.height);
        
        // Restore and draw the original person on top
        this.ctx.restore();
        this.ctx.globalCompositeOperation = "source-atop";
        this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      } catch (error) {
        console.error("Error processing frame with mask:", error);
        // Fallback: draw original image
        this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      }
    } else {
      // Fallback: just draw the image if no mask
      try {
        this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      } catch (error) {
        console.error("Error drawing image:", error);
      }
    }
  }

  updateBlurIntensity(intensity: number) {
    this.options.blurIntensity = Math.max(0, Math.min(100, intensity));
  }

  async stop() {
    // Stop processing first
    this.isProcessing = false;
    this.isMediaPipeReady = false;
    this.pendingFrame = false;

    // Wait a bit for any pending operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Clean up MediaPipe
    if (this.selfieSegmentation) {
      try {
        this.selfieSegmentation.close();
      } catch (error) {
        console.error("Error closing MediaPipe:", error);
      }
      this.selfieSegmentation = null;
    }

    // Stop output stream tracks
    if (this.outputStream) {
      this.outputStream.getTracks().forEach((track) => {
        if (track.kind === "video") {
          try {
            track.stop();
          } catch (error) {
            console.error("Error stopping video track:", error);
          }
        }
      });
      this.outputStream = null;
    }

    // Clean up video element
    if (this.processingVideo) {
      try {
        this.processingVideo.pause();
        this.processingVideo.srcObject = null;
      } catch (error) {
        console.error("Error cleaning up video element:", error);
      }
      this.processingVideo = null;
    }

    // Clear canvas
    this.canvas = null;
    this.ctx = null;
    this.originalStream = null;
  }
}

