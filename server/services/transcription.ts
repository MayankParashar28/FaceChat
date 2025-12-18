

// Reuse interface
export interface TranscriptionResult {
    text: string;
    language?: string;
    isPartial?: boolean;
}

export class TranscriptionService {
    private apiKey: string;

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            console.warn("⚠️ OPENAI_API_KEY is missing. Server-side captions will not work.");
        } else {
            console.log("✅ Transcription Service initialized with OpenAI API");
        }
    }

    /**
     * Transcribes an audio buffer using OpenAI Whisper API
     * @param audioBuffer The audio data (webm/wav)
     * @param originalFilename Optional filename helper
     */
    async transcribe(audioBuffer: Buffer, originalFilename: string = 'audio.webm'): Promise<TranscriptionResult> {
        if (!this.apiKey) {
            // Don't throw to avoid crashing socket loop, just log
            console.warn("Missing OpenAI API Key");
            return { text: "" };
        }

        // const tempDir = os.tmpdir(); 
        // const tempFilePath = path.join(tempDir, `transcribe_${Date.now()}_${Math.random().toString(36).substring(7)}_${originalFilename}`);

        try {
            // await fs.promises.writeFile(tempFilePath, audioBuffer);

            const formData = new FormData();
            // Read file back as a Blob-like object or use standard file stream for fetch
            // Node 18+ global fetch + FormData handles file from disk via Blob or fileFrom?
            // Actually simple node fetch with FormData expects a Blob.

            const fileBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
            formData.append('file', fileBlob, originalFilename);
            formData.append('model', 'whisper-1');
            formData.append('language', 'en');
            // formData.append('prompt', 'previous context if needed');

            // console.log(`Sending audio to OpenAI (${audioBuffer.length} bytes)...`);

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`OpenAI API Error ${response.status}: ${errorText}`);
                return { text: "" };
            }

            const data = await response.json();
            console.log("OpenAI Response:", JSON.stringify(data).substring(0, 100)); // Log success
            const text = data.text?.trim() || "";

            return { text };

        } catch (error) {
            console.error(`Transcription failed: ${error}`);
            return { text: "" };
        } finally {
            // No file cleanup needed
        }
    }
}

export const transcriptionService = new TranscriptionService();
