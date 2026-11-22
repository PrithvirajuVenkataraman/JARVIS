async function requestCameraStreamForFacingMode(targetMode) {
            const mode = normalizeFacingMode(targetMode);
            const constraintsExact = {
                video: {
                    facingMode: { exact: mode },
                    width: { ideal: mode === 'environment' ? 1920 : 1280 },
                    height: { ideal: mode === 'environment' ? 1080 : 720 }
                },
                audio: false
            };
            const constraintsIdeal = {
                video: {
                    facingMode: { ideal: mode },
                    width: { ideal: mode === 'environment' ? 1920 : 1280 },
                    height: { ideal: mode === 'environment' ? 1080 : 720 }
                },
                audio: false
            };

            try {
                return await navigator.mediaDevices.getUserMedia(constraintsExact);
            } catch (_) {
                try {
                    return await navigator.mediaDevices.getUserMedia(constraintsIdeal);
                } catch (_) {
                    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                }
            }
        }
