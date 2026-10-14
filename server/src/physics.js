// Authoritative 2D circle and AABB collision detection and resolution
import { ARENA, OBSTACLES, PLAYER_CONFIG } from '../../shared/constants.js';

/**
 * Resolves a circle's position against arena boundary walls.
 */
export function resolveBoundaryCollision(x, y, radius = PLAYER_CONFIG.RADIUS) {
  const minX = ARENA.WALL_THICKNESS + radius;
  const maxX = ARENA.WIDTH - ARENA.WALL_THICKNESS - radius;
  const minY = ARENA.WALL_THICKNESS + radius;
  const maxY = ARENA.HEIGHT - ARENA.WALL_THICKNESS - radius;

  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

/**
 * Resolves collision between a circle and an Axis-Aligned Bounding Box (AABB).
 * Returns the corrected {x, y} position of the circle.
 */
export function resolveCircleAABB(cx, cy, radius, box) {
  // Clamp circle center to the bounding box
  const nearestX = Math.max(box.x, Math.min(cx, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(cy, box.y + box.height));

  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const distSq = dx * dx + dy * dy;

  // No overlap
  if (distSq >= radius * radius) {
    return { x: cx, y: cy, collided: false };
  }

  // Inside or exactly on edge of the box
  if (distSq === 0) {
    // Circle center is inside the box: push out along shortest axis
    const leftDist = Math.abs(cx - box.x);
    const rightDist = Math.abs(box.x + box.width - cx);
    const topDist = Math.abs(cy - box.y);
    const bottomDist = Math.abs(box.y + box.height - cy);

    const minDist = Math.min(leftDist, rightDist, topDist, bottomDist);
    if (minDist === leftDist) {
      return { x: box.x - radius, y: cy, collided: true };
    } else if (minDist === rightDist) {
      return { x: box.x + box.width + radius, y: cy, collided: true };
    } else if (minDist === topDist) {
      return { x: cx, y: box.y - radius, collided: true };
    } else {
      return { x: cx, y: box.y + box.height + radius, collided: true };
    }
  }

  // Circle edge intersects box
  const dist = Math.sqrt(distSq);
  const penetration = radius - dist;
  const nx = dx / dist;
  const ny = dy / dist;

  return {
    x: cx + nx * penetration,
    y: cy + ny * penetration,
    collided: true,
  };
}

/**
 * Resolves a circle against all arena obstacles.
 */
export function resolveAllObstacles(x, y, radius = PLAYER_CONFIG.RADIUS, obstacles = OBSTACLES) {
  let curX = x;
  let curY = y;

  // Run resolution passes to handle corner intersections cleanly
  for (let pass = 0; pass < 2; pass++) {
    for (const obs of obstacles) {
      const res = resolveCircleAABB(curX, curY, radius, obs);
      curX = res.x;
      curY = res.y;
    }
    // Also re-clamp to boundaries
    const bound = resolveBoundaryCollision(curX, curY, radius);
    curX = bound.x;
    curY = bound.y;
  }

  return { x: curX, y: curY };
}

/**
 * Checks if two circles overlap.
 */
export function checkCircleOverlap(c1, c2, r1 = PLAYER_CONFIG.RADIUS, r2 = PLAYER_CONFIG.RADIUS) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const distSq = dx * dx + dy * dy;
  const minDist = r1 + r2;
  return distSq < (minDist * minDist);
}

/**
 * Softly resolves overlapping players so they don't walk through each other.
 */
export function resolvePlayerCollisions(players, radius = PLAYER_CONFIG.RADIUS) {
  const playerList = Object.values(players);
  const minDist = radius * 2;

  for (let i = 0; i < playerList.length; i++) {
    for (let j = i + 1; j < playerList.length; j++) {
      const p1 = playerList[i];
      const p2 = playerList[j];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const overlap = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const ny = dy / dist;

        p1.x -= nx * overlap;
        p1.y -= ny * overlap;
        p2.x += nx * overlap;
        p2.y += ny * overlap;

        // Re-resolve against obstacles and walls
        const r1 = resolveAllObstacles(p1.x, p1.y, radius);
        p1.x = r1.x;
        p1.y = r1.y;

        const r2 = resolveAllObstacles(p2.x, p2.y, radius);
        p2.x = r2.x;
        p2.y = r2.y;
      }
    }
  }
}
