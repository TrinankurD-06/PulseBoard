import { Monitor, StatusPage } from '@pulseboard/shared/models';
import { statusPageSchema } from '@pulseboard/shared/schemas';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function createStatusPageService({ publicCache }) {
  async function findInWorkspace(workspaceId, pageId) {
    if (!OBJECT_ID.test(pageId)) throw notFound('Status page not found');
    const page = await StatusPage.findOne({ _id: pageId, workspaceId });
    if (!page) throw notFound('Status page not found');
    return page;
  }

  /** A page may only list monitors of its own workspace. Also removes duplicates. */
  async function checkMonitors(workspaceId, monitorIds) {
    const unique = [...new Set(monitorIds)];
    const found = await Monitor.countDocuments({ _id: { $in: unique }, workspaceId });
    if (found !== unique.length) {
      throw badRequest("Some monitors don't exist in this workspace", [
        { path: 'monitorIds', message: 'Unknown monitor selected' },
      ]);
    }
    return unique;
  }

  async function save(page) {
    try {
      await page.save();
    } catch (err) {
      if (err?.code === 11000) {
        throw conflict('That address is already taken', [
          { path: 'slug', message: 'This slug is already in use' },
        ]);
      }
      throw err;
    }
    return page;
  }

  return {
    findInWorkspace,

    list(workspaceId, pagination) {
      return paginate(StatusPage, { workspaceId }, pagination, (query) =>
        query.sort({ createdAt: -1 }),
      );
    },

    async create(workspaceId, input) {
      const monitorIds = await checkMonitors(workspaceId, input.monitorIds);
      const page = await save(new StatusPage({ ...input, monitorIds, workspaceId }));
      publicCache.delete(page.slug); // a cached "not found" for this slug is now wrong
      return page;
    },

    /** Merge, re-validate the whole page, and drop cached public copies (old and new slug). */
    async update(workspaceId, pageId, patch) {
      const page = await findInWorkspace(workspaceId, pageId);
      const oldSlug = page.slug;
      const merged = statusPageSchema.parse({
        title: page.title,
        slug: page.slug,
        description: page.description ?? '',
        monitorIds: page.monitorIds.map(String),
        isPublic: page.isPublic,
        ...patch,
      });
      merged.monitorIds = await checkMonitors(workspaceId, merged.monitorIds);
      page.set(merged);
      await save(page);
      publicCache.delete(oldSlug);
      publicCache.delete(page.slug);
      return page;
    },

    async remove(workspaceId, pageId) {
      const page = await findInWorkspace(workspaceId, pageId);
      await page.deleteOne();
      publicCache.delete(page.slug);
    },
  };
}
