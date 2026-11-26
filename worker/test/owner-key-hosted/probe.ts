import {
  generateOwnerKey,
  hashOwnerKey,
  verifyOwnerKey,
  isOwnerKey
} from '../../src/services/ownerKey';

export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/verify') {
      return new Response('Not found', { status: 404 });
    }

    const start = Date.now();

    try {
      const key = 'ab'.repeat(32);
      const digest = await hashOwnerKey(key);

      const generated = generateOwnerKey();
      const generatedHash = await hashOwnerKey(generated);

      const checks = {
        correctKeyAccepted:
          await verifyOwnerKey(key, digest),

        incorrectKeyRejected:
          !(await verifyOwnerKey('cd'.repeat(32), digest)),

        malformedKeyRejected:
          !(await verifyOwnerKey('password', digest)),

        malformedHashRejected:
          !(await verifyOwnerKey(key, 'invalid')),

        generatedKeyValid:
          isOwnerKey(generated),

        generatedKeyVerified:
          await verifyOwnerKey(generated, generatedHash),

        generatedKeysDistinct:
          generated !== generateOwnerKey(),

        digestFormatValid:
          isOwnerKey(digest),

        digestMatchesReference:
          digest === '271a413bd339c5709fdceaec41f14f11e9fbfb5042d72d331c65f32b284cd09a',

        missingKeyRejected:
          !(await verifyOwnerKey(undefined, digest))
      };

      const passed = Object.values(checks)
        .filter(Boolean).length;

      const total = Object.keys(checks).length;
      const ok = passed === total;

      return Response.json({
        ok,
        passed,
        total,
        checks,
        elapsedMs: Date.now() - start
      }, {
        status: ok ? 200 : 500,
        headers: {
          'Cache-Control': 'no-store'
        }
      });

    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error)
      }, { status: 500 });
    }
  }
};
