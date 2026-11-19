<h3>welcome!</h3>

Hey there! My name is Gnanavel Premnath, studying computer science. Besides coding, I do VFX and 3D animations!

<img align="right" alt="GIF" src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWt4MDZ4ZWEzaG1sbWs2YWJpZWp4b3I5c3AxYnNwZXdxYm5hbHgzMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LSKHkpRJySs5W81D7B/giphy.gif" />

<h3>about me</h3>

- always down to talk about horror movies
- i love persona series and clair obscur
- i am currently learning visual computing and image manipulation
- reach out to me: premnathgnanavel150@gmail.com
- check out my <a href="https://www.instagram.com/gnani.dev">instagram</a> <sub><img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg" width="16" height="16" alt="Instagram logo" /></sub>

<img align="left" src="https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExMzZwZHM4bTNoNjd3cmx5NDI5a3VnODNlN2VqYmlvNG8xdG93N2RsaSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/5xRW2cUKfcyQg/giphy.gif" />

---

# Arcana // Hand Powers

A browser-based cinematic hand gesture experience powered by MediaPipe Tasks Vision.

## Run locally

From the repository directory, start any static HTTP server:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

Camera access requires localhost or HTTPS. Allow the browser camera permission when prompted.

## Controls

- **Open palm:** cyan force shield and aura
- **Closed fist:** fire and impact burst
- **Pinch:** electric sparks
- **Point:** guided magic projectile

Use **Stop Camera** to immediately release the webcam. The app only processes frames locally and does not upload video.

## Browser support

Use a current desktop or mobile Chrome, Edge, Firefox, or Safari build with WebRTC camera support and WebAssembly enabled. A secure context is required in browsers outside localhost.

MediaPipe and its hand model are loaded from public CDNs, so an internet connection is required on first use.
