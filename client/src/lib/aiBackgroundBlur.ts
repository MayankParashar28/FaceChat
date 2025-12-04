/**
 * AI-based background blur using MediaPipe SelfieSegmentation
 * Improved implementation with better error handling and fallbacks
 */

import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

export interface AIBlurOptions {
  modelSelection?: 0 | 1; // 0 for general, 1 for landscape
  blurIntensity?: number; // 0-100, default 15
}

export class AIBackgroundBlur {
  private selfieSegmentation: SelfieSegmentation | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private outputStream: MediaStream | null = null;
  private processingVideo: HTMLVideoElement | null = null;
  private isProcessing: boolean = false;
  private animationFrameId: number | null = null;
  private options: Required<AIBlurOptions>;
  private originalStream: MediaStream | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = 33; // ~30 FPS (33ms between frames)
  private isMediaPipeReady: boolean = false;
  private pendingFrame: boolean = false;
  private modelLoadPromise: Promise<void> | null = null;

  constructor(options: AIBlurOptions = {}) {
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
    this.processingVideo.muted = true;
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

      let metadataLoaded = false;
      let dataLoaded = false;

      const checkReady = () => {
        if (!this.processingVideo) return;
        
        if (metadataLoaded && dataLoaded && 
            this.processingVideo.videoWidth > 0 && 
            this.processingVideo.videoHeight > 0 &&
            !this.processingVideo.paused &&
            this.processingVideo.readyState >= this.processingVideo.HAVE_CURRENT_DATA) {
          clearTimeout(timeout);
          // Wait a bit more for first frame to be rendered
          setTimeout(() => {
            resolve();
          }, 200);
        }
      };

      this.processingVideo.onloadedmetadata = () => {
        if (this.processingVideo) {
          metadataLoaded = true;
          if (this.processingVideo.videoWidth > 0 && this.processingVideo.videoHeight > 0) {
            this.processingVideo.play()
              .then(() => {
                checkReady();
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

      this.processingVideo.onloadeddata = () => {
        dataLoaded = true;
        checkReady();
      };

      this.processingVideo.oncanplay = () => {
        checkReady();
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

    // Limit maximum dimensions to prevent memory issues
    const maxWidth = 1280;
    const maxHeight = 720;
    const videoWidth = Math.min(this.processingVideo.videoWidth, maxWidth);
    const videoHeight = Math.min(this.processingVideo.videoHeight, maxHeight);

    // Create canvas for processing
    this.canvas = document.createElement("canvas");
    this.canvas.width = videoWidth;
    this.canvas.height = videoHeight;
    this.ctx = this.canvas.getContext("2d", { 
      willReadFrequently: true,
      alpha: false // Disable alpha for better performance
    });
    
    if (!this.ctx) {
      throw new Error("Failed to get canvas context");
    }

    // Initialize MediaPipe SelfieSegmentation with proper error handling
    try {
      await this.initializeMediaPipe();
    } catch (error) {
      console.error("Failed to initialize MediaPipe:", error);
      throw new Error("AI background blur initialization failed");
    }

    // Wait for MediaPipe to be fully ready
    await this.waitForMediaPipeReady();

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

  private async initializeMediaPipe(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.selfieSegmentation = new SelfieSegmentation({
          locateFile: (file) => {
            // Use CDN for MediaPipe files
            return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
          },
        });

        this.selfieSegmentation.setOptions({
          modelSelection: this.options.modelSelection,
        });

        // Process each frame with error handling
        this.selfieSegmentation.onResults((results) => {
          this.pendingFrame = false;
          
          if (!this.isProcessing || !this.ctx || !this.canvas) {
            return;
          }
          
          try {
            this.processFrame(results);
          } catch (error) {
            console.error("Error processing frame:", error);
            // Fallback: draw original image if processing fails
            if (results?.image && this.ctx && this.canvas) {
              try {
                this.ctx.drawImage(
                  results.image, 
                  0, 
                  0, 
                  this.canvas.width, 
                  this.canvas.height
                );
              } catch (drawError) {
                console.error("Error drawing fallback image:", drawError);
              }
            }
          }
        });

        // Set a timeout for initialization
        setTimeout(() => {
          if (this.selfieSegmentation) {
            resolve();
          } else {
            reject(new Error("MediaPipe initialization timeout"));
          }
        }, 1000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private async waitForMediaPipeReady(): Promise<void> {
    return new Promise((resolve) => {
      // Give MediaPipe time to load WASM modules
      setTimeout(() => {
        this.isMediaPipeReady = true;
        resolve();
      }, 1000); // Increased delay for better stability
    });
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
        // Throttle to ~30 FPS
        const timeSinceLastFrame = currentTime - this.lastFrameTime;
        
        // Only process if enough time has passed and no pending frame
        if (timeSinceLastFrame >= this.frameInterval && !this.pendingFrame) {
          // Only process if video is ready and playing
          if (this.processingVideo &&
              !this.processingVideo.paused &&
              !this.processingVideo.ended &&
              this.processingVideo.readyState >= this.processingVideo.HAVE_CURRENT_DATA &&
              this.processingVideo.videoWidth > 0 &&
              this.processingVideo.videoHeight > 0 &&
              this.processingVideo.videoWidth <= 1920 &&
              this.processingVideo.videoHeight <= 1080 &&
              Number.isFinite(this.processingVideo.videoWidth) &&
              Number.isFinite(this.processingVideo.videoHeight)) {
            try {
              this.pendingFrame = true;
              this.lastFrameTime = currentTime;
              this.selfieSegmentation.send({ image: this.processingVideo });
            } catch (sendError: any) {
              this.pendingFrame = false;
              // Check for WASM errors
              if (sendError?.message?.includes("Aborted") || 
                  sendError?.message?.includes("abort") ||
                  sendError?.message?.includes("WASM") ||
                  sendError?.message?.includes("zero size") ||
                  sendError?.message?.includes("width is 0")) {
                console.error("MediaPipe error detected:", sendError.message);
                // Don't stop processing, just skip this frame
                return;
              }
              console.error("Error sending frame to MediaPipe:", sendError);
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
    if (!this.ctx || !this.canvas || !results || !this.isProcessing) {
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
        !Number.isFinite(image.height) ||
        image.width > 4096 ||
        image.height > 4096) {
      console.warn("Invalid image dimensions in processFrame:", image?.width, image?.height);
      return;
    }

    // Update canvas size if needed (with size limits)
    const maxWidth = 1280;
    const maxHeight = 720;
    const newWidth = Math.min(maxWidth, Math.max(1, Math.floor(image.width)));
    const newHeight = Math.min(maxHeight, Math.max(1, Math.floor(image.height)));
    
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply background blur with person segmentation
    if (segmentationMask && 
        segmentationMask.width > 0 && 
        segmentationMask.height > 0) {
      try {
        // Step 1: Create blurred version of the entire image
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = this.canvas.width;
        blurCanvas.height = this.canvas.height;
        const blurCtx = blurCanvas.getContext("2d");
        
        if (blurCtx) {
          // Draw original image
          blurCtx.drawImage(image, 0, 0, blurCanvas.width, blurCanvas.height);
          
          // Apply blur filter
          blurCtx.filter = `blur(${this.options.blurIntensity}px)`;
          blurCtx.drawImage(image, 0, 0, blurCanvas.width, blurCanvas.height);
          
          // Draw blurred background to main canvas
          this.ctx.drawImage(blurCanvas, 0, 0);
        }

        // Step 2: Use segmentation mask to show original person
        // The mask is inverted - white areas are person, black areas are background
        // So we'll use it to composite the original person over the blurred background
        
        // Draw the original person with mask
        this.ctx.globalCompositeOperation = "destination-in";
        this.ctx.drawImage(segmentationMask, 0, 0, this.canvas.width, this.canvas.height);
        
        // Now draw original image (this will only show where mask is white)
        this.ctx.globalCompositeOperation = "source-atop";
        this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
        
        // Reset composite operation
        this.ctx.globalCompositeOperation = "source-over";
      } catch (error) {
        console.error("Error processing frame with mask:", error);
        // Fallback: draw original image
        try {
          this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
        } catch (drawError) {
          console.error("Error drawing fallback image:", drawError);
        }
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

    // Wait a bit for pending operations and frame processing to stop
    await new Promise(resolve => setTimeout(resolve, 200));

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

    // Stop output stream tracks (canvas tracks only)
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
        // Stop the video completely
        this.processingVideo.pause();
        this.processingVideo.srcObject = null;
        // Clear any event listeners
        this.processingVideo.onloadedmetadata = null;
        this.processingVideo.onloadeddata = null;
        this.processingVideo.oncanplay = null;
        this.processingVideo.onerror = null;
      } catch (error) {
        console.error("Error cleaning up video element:", error);
      }
      this.processingVideo = null;
    }

    // Clear canvas
    this.canvas = null;
    this.ctx = null;
    // Keep original stream reference for restoration
  }
}

