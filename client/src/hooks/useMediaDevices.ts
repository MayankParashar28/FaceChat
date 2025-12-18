import { useState, useEffect } from 'react';

export function useMediaDevices() {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission slightly to ensure labels are active (optional, usually handled by main app)
                const devs = await navigator.mediaDevices.enumerateDevices();
                setDevices(devs);
            } catch (err) {
                console.error("Error enumerating devices:", err);
            }
        };

        getDevices();

        navigator.mediaDevices.addEventListener('devicechange', getDevices);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices);
        };
    }, []);

    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    const audioInputDevices = devices.filter(d => d.kind === 'audioinput');
    const audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');

    return { devices, videoDevices, audioInputDevices, audioOutputDevices };
}
