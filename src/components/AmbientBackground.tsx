import { useEffect, useRef, useState } from "react";
import { useAuth } from "../store/auth";

/*
 * Apple Music–style flowing background: the album art is shrunk to a tiny
 * texture (which blurs it for free) and sampled through slowly rotating,
 * domain-warped coordinates in a fragment shader. Rendered at a fraction of the
 * window size and stretched by the compositor, so it costs very little GPU.
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_mix;
uniform float u_time;
uniform float u_aspect;

vec3 art(sampler2D tex, vec2 uv, float t) {
  vec2 p = uv - 0.5;
  p.x *= u_aspect;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float dir = mod(fi, 2.0) * 2.0 - 1.0;
    float ang = t * (0.045 + 0.02 * fi) * dir + fi * 1.9;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 q = rot * p * (0.62 + 0.16 * fi);
    q += 0.10 * vec2(sin(q.y * 3.5 + t * 0.31 + fi * 2.0), cos(q.x * 3.2 - t * 0.27 + fi * 1.3));
    q += 0.06 * vec2(cos(t * 0.11 + fi), sin(t * 0.13 - fi));
    acc += texture2D(tex, q + 0.5).rgb;
  }
  return acc * 0.25;
}

void main() {
  vec3 c = mix(art(u_a, v_uv, u_time), art(u_b, v_uv, u_time), u_mix);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.45);
  c = c * 0.82 + 0.02;
  vec2 d = v_uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.55;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const TEX = 24;
const SCALE = 1 / 8;
const FPS = 30;

class Renderer {
  private gl: WebGLRenderingContext;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private uMix: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uAspect: WebGLUniformLocation;
  private mixStart = 0;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private scratch = document.createElement("canvas");
  paused = false;
  still = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" });
    if (!gl) throw new Error("no webgl");
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texA = this.makeTexture();
    this.texB = this.makeTexture();
    gl.uniform1i(gl.getUniformLocation(prog, "u_a"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "u_b"), 1);
    this.uMix = gl.getUniformLocation(prog, "u_mix")!;
    this.uTime = gl.getUniformLocation(prog, "u_time")!;
    this.uAspect = gl.getUniformLocation(prog, "u_aspect")!;
    this.scratch.width = this.scratch.height = TEX;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private makeTexture() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([28, 28, 30, 255]));
    return t;
  }

  setImage(img: HTMLImageElement | null) {
    const gl = this.gl;
    // Current B becomes A; the new image fades in as B.
    [this.texA, this.texB] = [this.texB, this.texA];
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    if (img) {
      const ctx = this.scratch.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, TEX, TEX);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch);
      } catch {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([28, 28, 30, 255]));
      }
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([28, 28, 30, 255]));
    }
    this.mixStart = performance.now();
    this.draw(performance.now());
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const fading = now - this.mixStart < 1300;
    if ((this.paused || this.still) && !fading) return;
    if (now - this.last < 1000 / FPS) return;
    this.last = now;
    this.draw(now);
  }

  private draw(now: number) {
    const gl = this.gl;
    const c = this.canvas;
    const w = Math.max(16, Math.round(c.clientWidth * SCALE));
    const h = Math.max(16, Math.round(c.clientHeight * SCALE));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      gl.viewport(0, 0, w, h);
    }
    const mix = Math.min(1, (now - this.mixStart) / 1200);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.uniform1f(this.uMix, mix * mix * (3 - 2 * mix));
    gl.uniform1f(this.uTime, this.still ? 12 : (now - this.start) / 1000);
    gl.uniform1f(this.uAspect, w / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

export function AmbientBackground({ coverId, paused, still }: { coverId?: string; paused?: boolean; still?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [failed, setFailed] = useState(false);
  const client = useAuth((s) => s.client);
  // A distinct URL so the CORS request never collides with a cached no-CORS <img> response.
  const url = coverId && client ? `${client.coverUrl(coverId, 160)}&cors=1` : undefined;

  useEffect(() => {
    try {
      rendererRef.current = new Renderer(canvasRef.current!);
    } catch {
      setFailed(true);
    }
    return () => rendererRef.current?.destroy();
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (!url) return r.setImage(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => r.setImage(img);
    img.onerror = () => r.setImage(null);
    img.src = url;
  }, [url, failed]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.paused = !!paused;
      rendererRef.current.still = !!still;
    }
  }, [paused, still]);

  return (
    <div className="ambient" aria-hidden>
      {failed ? (
        url && <div className="ambient-fallback" style={{ backgroundImage: `url("${url}")` }} />
      ) : (
        <canvas ref={canvasRef} />
      )}
      <div className="ambient-grain" />
    </div>
  );
}
