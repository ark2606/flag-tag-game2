// Authoritative 2D platform physics, swept collision detection, and spring pads
import { ARENA, PLATFORMS, SPRINGS, PLAYER_CONFIG } from '../../shared/constants.js';

/**
 * Resolves a circle's position against arena boundary walls (left, right, ceiling, floor).
 */
export function resolveBoundaryCollision(x, y, radius = PLAYER_CONFIG.RADIUS) {
  const minX = ARENA.WALL_THICKNESS + radius;
  const maxX = ARENA.WIDTH - ARENA.WALL_THICKNESS - radius;
  const minY = ARENA.WALL_THICKNESS + radius;
  const maxY = ARENA.GROUND_Y - radius; // Ground floor altitude

  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

/**
 * Checks if a player's feet land onto a one-way platform from above during a physics tick.
 * Swept crossing detection prevents passing through platforms when falling fast.
 *
 * @param {number} prevY Player Y coordinate before this physics tick
 * @param {number} newY Player Y coordinate after integrating velocity
 * @param {number} x Player X coordinate
 * @param {number} radius Player radius
 * @param {object} platform Platform rectangle { x, y, width, height }
 * @returns {boolean} True if player landed onto this platform
 */
export function checkPlatformLanding(prevY, newY, x, radius = PLAYER_CONFIG.RADIUS, platform) {
  // Horizontal bounds check with small tolerance
  const footTolerance = radius * 0.7;
  const playerLeft = x - footTolerance;
  const playerRight = x + footTolerance;
  const platLeft = platform.x;
  const platRight = platform.x + platform.width;

  if (playerRight < platLeft || playerLeft > platRight) {
    return false;
  }

  // Vertical swept collision check
  const prevFeet = prevY + radius;
  const newFeet = newY + radius;
  const platTop = platform.y;

  // The player's feet must have been above or at platform surface in previous frame (with 8px tolerance),
  // and reached or passed through the platform surface in the current frame.
  return prevFeet <= platTop + 8 && newFeet >= platTop;
}

/**
 * Checks if a player lands onto or steps onto any spring launcher pad / tyre.
 *
 * @param {number} prevY
 * @param {number} newY
 * @param {number} x
 * @param {number} radius
 * @param {Array} springs
 * @returns {object|null} The triggered spring or null
 */
export function checkSpringPadCollision(prevY, newY, x, radius = PLAYER_CONFIG.RADIUS, springs = SPRINGS) {
  const prevFeet = prevY + radius;
  const newFeet = newY + radius;

  for (const spring of springs) {
    // Horizontal overlap check with generous tolerance (radius * 0.8 so any contact triggers immediately)
    const springLeft = spring.x - radius * 0.8;
    const springRight = spring.x + spring.width + radius * 0.8;
    const springTop = spring.y;
    const springBottom = spring.y + spring.height;

    if (x >= springLeft && x <= springRight) {
      // 1. Falling/landing downward onto spring top
      const downwardHit = (prevFeet <= springTop + 16 && newFeet >= springTop - 8);

      // 2. Walking horizontally onto spring or standing on spring pad
      // Check if feet are within spring's vertical bounds (with generous tolerance for platform/ground walking)
      const standingOnSpring = (newFeet >= springTop - 10 && newFeet <= springBottom + 16);

      if (downwardHit || standingOnSpring) {
        return spring;
      }
    }
  }

  return null;
}

/**
 * Resolves collision between a circle and an Axis-Aligned Bounding Box (AABB).
 * Used for solid obstacles or boundary blocks.
 */
export function resolveCircleAABB(cx, cy, radius, box) {
  const nearestX = Math.max(box.x, Math.min(cx, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(cy, box.y + box.height));

  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= radius * radius) {
    return { x: cx, y: cy, collided: false };
  }

  if (distSq === 0) {
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
 * Resolves a circle against solid obstacles and arena boundaries.
 */
export function resolveAllObstacles(x, y, radius = PLAYER_CONFIG.RADIUS, platforms = PLATFORMS) {
  let curX = x;
  let curY = y;

  const bound = resolveBoundaryCollision(curX, curY, radius);
  curX = bound.x;
  curY = bound.y;

  return { x: curX, y: curY };
}

/**
 * Checks if two circles overlap or are within generous tag reach.
 */
export function checkCircleOverlap(c1, c2, r1 = PLAYER_CONFIG.RADIUS, r2 = PLAYER_CONFIG.RADIUS) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const distSq = dx * dx + dy * dy;
  const minDist = (r1 + r2) * 1.35; // Generous reach (~65px) so visually touching players always transfer
  return distSq <= (minDist * minDist);
}

/**
 * Softly resolves overlapping players horizontally so they don't walk through each other.
 * Only the moving player gets pushed back; stationary players stay locked in place.
 */
export function resolvePlayerCollisions(players, radius = PLAYER_CONFIG.RADIUS) {
  const playerList = Array.from(players.values ? players.values() : Object.values(players));
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
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;

        // Check which player is moving (has non-zero input)
        const p1Moving = Math.abs(p1.inputX || 0) > 0.01;
        const p2Moving = Math.abs(p2.inputX || 0) > 0.01;

        if (p1Moving && !p2Moving) {
          // Only p1 is moving, push p1 back entirely
          p1.x -= nx * overlap;
          p1.y -= ny * overlap;

          const b1 = resolveBoundaryCollision(p1.x, p1.y, radius);
          p1.x = b1.x;
          p1.y = b1.y;
        } else if (p2Moving && !p1Moving) {
          // Only p2 is moving, push p2 back entirely
          p2.x += nx * overlap;
          p2.y += ny * overlap;

          const b2 = resolveBoundaryCollision(p2.x, p2.y, radius);
          p2.x = b2.x;
          p2.y = b2.y;
        } else {
          // Both moving or both stationary, split the push equally
          const halfOverlap = overlap * 0.5;
          p1.x -= nx * halfOverlap;
          p1.y -= ny * halfOverlap;
          p2.x += nx * halfOverlap;
          p2.y += ny * halfOverlap;

          const b1 = resolveBoundaryCollision(p1.x, p1.y, radius);
          p1.x = b1.x;
          p1.y = b1.y;

          const b2 = resolveBoundaryCollision(p2.x, p2.y, radius);
          p2.x = b2.x;
          p2.y = b2.y;
        }
      }
    }
  }
}
