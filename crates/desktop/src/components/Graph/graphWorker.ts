/// <reference lib="webworker" />
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";

export interface WorkerNodeSpec {
  path: string;
}

export interface WorkerLinkSpec {
  from: number;
  to: number;
}

export type WorkerIn =
  | {
      type: "init";
      specs: WorkerNodeSpec[];
      links: WorkerLinkSpec[];
      linkDistance: number;
      repulsion: number;
      centerStrength: number;
      linkStrength: number;
      cx: number;
      cy: number;
    }
  | {
      type: "settings";
      linkDistance: number;
      repulsion: number;
      centerStrength: number;
      linkStrength: number;
    }
  | { type: "center"; cx: number; cy: number }
  | { type: "restart" }
  | { type: "reset"; linkDistance: number }
  | { type: "pin"; index: number; x?: number; y?: number; pinned: boolean };

export type WorkerOut = {
  type: "tick";
  positions: Float32Array;
  settled: boolean;
};

interface WNode extends SimulationNodeDatum {
  path: string;
}

interface WLink {
  source: number | WNode;
  target: number | WNode;
}

let sim: ReturnType<typeof forceSimulation<WNode>> | null = null;
let nodes: WNode[] = [];
let links: WLink[] = [];
let prevByPath = new Map<string, [number, number]>();
let linkDistance = 90;
let repulsion = 10;
let centerStrength = 0.52;
let linkStrength = 1;
let cx = 0;
let cy = 0;

function post(settled: boolean) {
  const pos = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i += 1) {
    pos[i * 2] = nodes[i].x ?? 0;
    pos[i * 2 + 1] = nodes[i].y ?? 0;
  }
  self.postMessage(
    { type: "tick", positions: pos, settled },
    [pos.buffer],
  );
}

function buildSim(restart: boolean) {
  sim?.stop();
  const linkForce = forceLink<WNode, WLink>(links)
    .id((d) => d.index ?? 0)
    .distance(linkDistance)
    .strength(linkStrength);
  sim = forceSimulation(nodes)
    .force("link", linkForce)
    .force("charge", forceManyBody().strength(-repulsion * 35))
    .force("center", forceCenter(cx, cy))
    .force("x", forceX(cx).strength(centerStrength * 0.08))
    .force("y", forceY(cy).strength(centerStrength * 0.08))
    .alphaDecay(0.02)
    .alphaMin(0.001)
    .on("tick", () => post(false))
    .on("end", () => post(true));
  if (restart) {
    sim.alpha(0.3).restart();
  }
  post(false);
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      prevByPath = new Map(
        nodes.map((n) => [n.path, [n.x ?? 0, n.y ?? 0]]),
      );
      linkDistance = msg.linkDistance;
      repulsion = msg.repulsion;
      centerStrength = msg.centerStrength;
      linkStrength = msg.linkStrength;
      cx = msg.cx;
      cy = msg.cy;
      const radius = Math.sqrt(Math.max(msg.specs.length, 1)) * linkDistance;
      nodes = msg.specs.map((s) => {
        const prev = prevByPath.get(s.path);
        return {
          path: s.path,
          x: prev ? prev[0] : (Math.random() - 0.5) * radius,
          y: prev ? prev[1] : (Math.random() - 0.5) * radius,
        };
      });
      links = msg.links.map((l) => ({ source: l.from, target: l.to }));
      buildSim(true);
      break;
    }
    case "settings": {
      linkDistance = msg.linkDistance;
      repulsion = msg.repulsion;
      if (!sim) break;
      sim.force(
        "link",
        forceLink<WNode, WLink>(links)
          .id((d) => d.index ?? 0)
          .distance(linkDistance)
          .strength(linkStrength),
      );
      sim.force("charge", forceManyBody().strength(-repulsion * 35));
      sim.force("x", forceX(cx).strength(centerStrength * 0.08));
      sim.force("y", forceY(cy).strength(centerStrength * 0.08));
      sim.alpha(0.3).restart();
      break;
    }
    case "center": {
      cx = msg.cx;
      cy = msg.cy;
      if (!sim) break;
      sim.force("center", forceCenter(cx, cy));
      sim.force("x", forceX(cx).strength(centerStrength * 0.08));
      sim.force("y", forceY(cy).strength(centerStrength * 0.08));
      break;
    }
    case "restart": {
      if (!sim) break;
      sim.alpha(0.3).restart();
      break;
    }
    case "reset": {
      linkDistance = msg.linkDistance;
      const radius = Math.sqrt(Math.max(nodes.length, 1)) * linkDistance;
      for (const n of nodes) {
        n.x = (Math.random() - 0.5) * radius;
        n.y = (Math.random() - 0.5) * radius;
        n.vx = 0;
        n.vy = 0;
        n.fx = undefined;
        n.fy = undefined;
      }
      buildSim(true);
      break;
    }
    case "pin": {
      const n = nodes[msg.index];
      if (!n) break;
      if (msg.pinned) {
        n.fx = msg.x ?? n.x;
        n.fy = msg.y ?? n.y;
      } else {
        n.fx = undefined;
        n.fy = undefined;
      }
      if (sim) sim.alpha(0.3).restart();
      break;
    }
  }
};
