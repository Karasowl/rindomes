"use client";

import { useEffect, useRef } from "react";

/**
 * Fondo WebGL de marca: un campo de luz que "fluye" en los colores de RindoMes
 * (crema base, blooms lima, sombras olivo) usando domain-warped fbm noise. Es la
 * pieza memorable de la landing —dinero/energía en movimiento— pero deliberadamente
 * suave para que el texto encima siga siendo legible.
 *
 * Sin dependencias (WebGL crudo). Respeta prefers-reduced-motion (un solo frame),
 * pausa con la pestaña oculta, limpia todo al desmontar y cae con gracia al gradiente
 * CSS .mesh-bg si no hay WebGL.
 */
const FRAG = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_scroll;

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * vec2(u_resolution.x / u_resolution.y, 1.0) * 1.55;
  // El campo se desplaza con el scroll (1:1 con un viewport) para que se sienta pintado
  // sobre la página, no congelado detrás de ella.
  p.y += u_scroll * 1.55;
  float t = u_time * 0.04;

  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p + 1.7 * q + vec2(8.3, 2.8) + t * 0.5),
    fbm(p + 1.7 * q + vec2(1.2, 6.4) - t * 0.5)
  );
  float f = fbm(p + 2.0 * r);

  vec3 cream = vec3(0.976, 0.945, 0.905);
  vec3 lime  = vec3(0.80, 1.0, 0.0);
  vec3 olive = vec3(0.31, 0.40, 0.0);

  vec3 col = cream;
  col = mix(col, lime, smoothstep(0.36, 0.95, f) * 0.80);
  col = mix(col, olive, smoothstep(0.50, 1.06, r.x) * 0.20);
  col += lime * 0.10 * smoothstep(0.92, 0.0, uv.y);

  float vig = smoothstep(1.32, 0.08, length(uv - 0.5));
  col = mix(cream, col, 0.78 + 0.22 * vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const glc = cv.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!glc) return; // CSS .mesh-bg sigue de fondo como fallback.

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const compile = (type: number, src: string) => {
      const shader = glc.createShader(type)!;
      glc.shaderSource(shader, src);
      glc.compileShader(shader);
      return shader;
    };
    const program = glc.createProgram()!;
    glc.attachShader(program, compile(glc.VERTEX_SHADER, VERT));
    glc.attachShader(program, compile(glc.FRAGMENT_SHADER, FRAG));
    glc.linkProgram(program);
    if (!glc.getProgramParameter(program, glc.LINK_STATUS)) return;
    glc.useProgram(program);

    const buffer = glc.createBuffer();
    glc.bindBuffer(glc.ARRAY_BUFFER, buffer);
    glc.bufferData(glc.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), glc.STATIC_DRAW);
    const aPos = glc.getAttribLocation(program, "a_pos");
    glc.enableVertexAttribArray(aPos);
    glc.vertexAttribPointer(aPos, 2, glc.FLOAT, false, 0, 0);

    const uTime = glc.getUniformLocation(program, "u_time");
    const uRes = glc.getUniformLocation(program, "u_resolution");
    const uScroll = glc.getUniformLocation(program, "u_scroll");

    const draw = (elapsed: number) => {
      glc.uniform1f(uTime, elapsed);
      glc.uniform1f(uScroll, (window.scrollY || 0) / Math.max(1, window.innerHeight));
      glc.drawArrays(glc.TRIANGLES, 0, 3);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      glc.viewport(0, 0, cv.width, cv.height);
      glc.uniform2f(uRes, cv.width, cv.height);
      if (reduce) draw(0);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let start = 0; // se siembra en el primer frame (Date.now no disponible en este entorno).
    let running = true;

    const frame = (now: number) => {
      if (!running) return;
      if (start === 0) start = now;
      draw((now - start) / 1000);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // En reduced-motion no hay loop de animación; redibuja el frame estático al hacer scroll
    // para que el desplazamiento del campo siga alineado con la página.
    const onScroll = () => {
      if (reduce) draw(0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduce) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      glc.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
