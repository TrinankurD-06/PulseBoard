// WebGL renderer of the signal field: one static buffer of grid points, and a
// vertex shader that evaluates the wave, ripples, down regions, perspective
// and colour per point (the same rules as fieldMath.fieldPoint). No library.
import {
  BINS,
  MAX_RIPPLES,
  RIPPLE,
  VIEW,
  WAVE,
  generateGrid,
  gridDims,
  selectPointBudget,
} from './fieldMath.js';

// GLSL float literal.
const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const VERTEX = `
precision highp float;
attribute vec3 aPos;
uniform float uPhase;
uniform float uAmp;
uniform float uDpr;
uniform vec3 uRip[${MAX_RIPPLES}];
uniform float uDown[${BINS}];
uniform vec3 uFar;
uniform vec3 uNear;
uniform vec3 uAccent;
uniform vec3 uDownCol;
varying vec4 vColor;

float sampleDown(float gx) {
  float p = clamp(gx, 0.0, 1.0) * ${f(BINS - 1)};
  int i = int(floor(p));
  float a = uDown[i];
  float b = uDown[i < ${BINS - 1} ? i + 1 : i];
  return mix(a, b, p - floor(p));
}

float waveHeight(float x, float z, float turb) {
  float a = sin(x * ${f(WAVE.ax)} + z * ${f(WAVE.az)} + uPhase * ${f(WAVE.ap)});
  float b = sin(x * ${f(WAVE.bx)} + z * ${f(WAVE.bz)} + uPhase * ${f(WAVE.bp)} + ${f(WAVE.boff)}) * ${f(WAVE.bw)};
  float c = sin(z * ${f(WAVE.cz)} + uPhase * ${f(WAVE.cp)} + x * ${f(WAVE.cx)}) * ${f(WAVE.cw)};
  float t = sin(x * ${f(WAVE.t1x)} + z * ${f(WAVE.t1z)} + uPhase * ${f(WAVE.t1p)})
          * sin(x * ${f(WAVE.t2x)} + z * ${f(WAVE.t2z)} + uPhase * ${f(WAVE.t2p)})
          * turb * ${f(WAVE.tw)};
  return (a + b + c) / ${f(WAVE.norm)} + t;
}

float rippleSum(float x, float z) {
  float sum = 0.0;
  for (int k = 0; k < ${MAX_RIPPLES}; k++) {
    vec3 r = uRip[k];
    if (r.z > 0.0) {
      float d = length(vec2(x - r.x, (z - 0.5) * ${f(RIPPLE.zScale)}));
      float u = d - r.y * ${f(RIPPLE.speed)};
      sum += r.z * sin(u * ${f(RIPPLE.k)}) * exp(-u * u * ${f(RIPPLE.w)}) * exp(-r.y * ${f(RIPPLE.decay)});
    }
  }
  return sum;
}

void main() {
  float gx = aPos.x;
  float gz = aPos.y;
  float x = gx * 2.0 - 1.0;
  float down = sampleDown(gx);
  float w = waveHeight(x, gz, down);
  float rip = rippleSum(x, gz);
  float k = 1.0 / (1.0 + ${f(VIEW.k)} * gz);
  float p = (1.0 - k) / (1.0 - 1.0 / (1.0 + ${f(VIEW.k)}));
  float near = 1.0 - p;
  float off = w * (${f(VIEW.ampMin)} + ${f(VIEW.ampRange)} * uAmp) * (1.0 + ${f(VIEW.downBoost)} * down)
            + rip * ${f(VIEW.rippleGain)};
  float lift = clamp(0.5 + off / ${f(2 * VIEW.liftScale)}, 0.0, 1.0);
  float alpha = (0.14 + 0.86 * pow(max(near, 0.0001), 1.4)) * (0.5 + 0.5 * lift);
  alpha = clamp(alpha * ${f(VIEW.alphaGain)} * (1.0 + 0.9 * down), 0.0, 1.0);
  float sx = 0.5 + x * 0.5 * mix(${f(VIEW.xsNear)}, ${f(VIEW.xsFar)}, p);
  float sy = mix(${f(VIEW.yNear)}, ${f(VIEW.yFar)}, p) - off * k;
  vec3 col = mix(uFar, uNear, near);
  col = mix(col, uAccent, lift * 0.45);
  col = mix(col, uDownCol, down * 0.85);
  gl_Position = vec4(sx * 2.0 - 1.0, 1.0 - sy * 2.0, 0.0, 1.0);
  gl_PointSize = mix(${f(VIEW.sizeFar)}, ${f(VIEW.sizeNear)}, near) * (0.8 + 0.4 * aPos.z) * uDpr;
  vColor = vec4(col * alpha, alpha);
}
`;

// Soft round dot; premultiplied colour, blended additively (dark) or over (light).
const FRAGMENT = `
precision mediump float;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.0, 0.5, d);
  gl_FragColor = vColor * (a * 1.5);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

/**
 * Creates the renderer on `canvas`, or returns null when WebGL is unavailable
 * or the shaders fail (the caller then mounts the 2D fallback on a new canvas).
 * Returns { kind, points, resize(w, h, dpr, opts), draw(sim), restore(), destroy() }.
 */
export function createWebglField(canvas, initialColors) {
  let colors = initialColors;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  let program = null;
  let buffer = null;
  let loc = {};
  let count = 0;
  let grid = null; // kept so a restored context can re-upload it

  function build() {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    loc = {
      aPos: gl.getAttribLocation(program, 'aPos'),
      uPhase: gl.getUniformLocation(program, 'uPhase'),
      uAmp: gl.getUniformLocation(program, 'uAmp'),
      uDpr: gl.getUniformLocation(program, 'uDpr'),
      uRip: gl.getUniformLocation(program, 'uRip[0]'),
      uDown: gl.getUniformLocation(program, 'uDown[0]'),
    };
    gl.useProgram(program);
    applyColors();
    buffer = gl.createBuffer();
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    if (grid) upload();
  }

  // Colour uniforms and the blend mode: premultiplied dots add up on a dark page
  // and are laid over one another on a light page.
  function applyColors() {
    gl.useProgram(program);
    gl.uniform3fv(gl.getUniformLocation(program, 'uFar'), colors.far);
    gl.uniform3fv(gl.getUniformLocation(program, 'uNear'), colors.near);
    gl.uniform3fv(gl.getUniformLocation(program, 'uAccent'), colors.accent);
    gl.uniform3fv(gl.getUniformLocation(program, 'uDownCol'), colors.down);
    gl.blendFunc(gl.ONE, colors.additive === false ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
  }

  function upload() {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
  }

  try {
    build();
  } catch {
    destroy();
    return null;
  }

  let dpr = 1;

  function destroy() {
    if (!gl.isContextLost()) {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    }
    buffer = null;
    program = null;
    grid = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  const engine = {
    kind: 'webgl',
    get points() {
      return count;
    },
    /** Sizes the backing store and rebuilds the grid for the point budget. */
    resize(width, height, ratio, { cores, density } = {}) {
      dpr = ratio;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      const budget = selectPointBudget({ width, height, cores, density });
      const dims = gridDims(budget, width / Math.max(1, height));
      grid = generateGrid(dims.cols, dims.rows);
      count = dims.count;
      if (program) upload();
      return count;
    },
    draw(sim) {
      if (!program || gl.isContextLost() || !count) return;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(loc.uPhase, sim.phase);
      gl.uniform1f(loc.uAmp, sim.amplitude);
      gl.uniform1f(loc.uDpr, dpr);
      gl.uniform3fv(loc.uRip, sim.ripples);
      gl.uniform1fv(loc.uDown, sim.bins);
      gl.drawArrays(gl.POINTS, 0, count);
    },
    /** A theme change: new colours and blend mode, applied on the next draw. */
    setColors(next) {
      colors = next;
      if (program && !gl.isContextLost()) applyColors();
    },
    /** After webglcontextrestored: every GL object is gone, so rebuild them. */
    restore() {
      build();
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    destroy,
  };
  return engine;
}
