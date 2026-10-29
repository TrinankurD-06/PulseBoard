import { ROLES } from '@pulseboard/shared/constants';
import { Copy, ExternalLink, Globe, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../api/http.js';
import { useMonitors } from '../api/monitors.js';
import {
  publicStatusUrl,
  useCreateStatusPage,
  useDeleteStatusPage,
  useStatusPages,
  useUpdateStatusPage,
} from '../api/statusPages.js';
import PageHeader from '../components/PageHeader.jsx';
import StatusPageForm from '../components/statusPages/StatusPageForm.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import { useConfirm } from '../components/ui/confirmContext.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import Modal from '../components/ui/Modal.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';

async function copyLink(slug) {
  try {
    await navigator.clipboard.writeText(publicStatusUrl(slug));
    toast.success('Link copied');
  } catch {
    toast.error('Could not copy. Select the link and copy it manually.');
  }
}

function PageCard({ page, canEdit, onEdit, onDelete }) {
  const url = publicStatusUrl(page.slug);
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-light tracking-[-0.02em] text-fg">{page.title}</h3>
        {page.isPublic ? (
          <Badge tone="green" className="gap-1">
            <Globe className="h-3 w-3" /> Public
          </Badge>
        ) : (
          <Badge className="gap-1">
            <Lock className="h-3 w-3" /> Private
          </Badge>
        )}
      </div>
      {page.description && <p className="mt-1 text-sm text-muted">{page.description}</p>}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 font-mono text-[13px] break-all text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-fg"
      >
        /status/{page.slug} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </a>
      <p className="mt-1 text-xs text-faint">
        {page.monitorIds.length} monitor{page.monitorIds.length === 1 ? '' : 's'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={() => copyLink(page.slug)}>
          <Copy className="h-4 w-4" /> Copy link
        </Button>
        {canEdit && (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onDelete}
              aria-label={`Delete ${page.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function StatusPages() {
  const { wid, can } = useCurrentWorkspace();
  const canEdit = can(ROLES.MEMBER);
  const { data: pages, isPending, isError } = useStatusPages(wid);
  const { data: monitors = [] } = useMonitors(wid);
  const createPage = useCreateStatusPage(wid);
  const updatePage = useUpdateStatusPage(wid);
  const deletePage = useDeleteStatusPage(wid);
  const confirm = useConfirm();
  // null = closed, {} = creating, page = editing
  const [editing, setEditing] = useState(null);

  async function onSubmit(values) {
    try {
      if (editing?.id) {
        await updatePage.mutateAsync({ id: editing.id, ...values });
        toast.success('Status page updated');
      } else {
        const page = await createPage.mutateAsync(values);
        toast.success('Status page created', {
          action: {
            label: 'Open',
            onClick: () => window.open(publicStatusUrl(page.slug), '_blank'),
          },
        });
      }
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error; // let the form show field errors (e.g. slug taken)
    }
  }

  async function onDelete(page) {
    const confirmed = await confirm({
      title: 'Delete status page',
      message: `Delete "${page.title}"? Its public link will stop working.`,
      confirmLabel: 'Delete page',
    });
    if (!confirmed) return;
    try {
      await deletePage.mutateAsync(page.id);
      toast.success('Status page deleted');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const newButton = canEdit && (
    <Button onClick={() => setEditing({})}>
      <Plus className="h-4 w-4" /> New status page
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Status pages."
        phrase="Public pages that show your customers whether your services are up."
        action={newButton}
      />

      {isError && <p className="text-sm text-status-down">Couldn&apos;t load status pages.</p>}
      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 rounded-card" />
          ))}
        </div>
      )}

      {pages?.length === 0 && (
        <EmptyState
          title="No status pages yet"
          description="Share uptime with your users on a page that needs no login."
          action={
            canEdit && <RingDotCta onClick={() => setEditing({})}>New status page</RingDotCta>
          }
        />
      )}

      {pages?.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              canEdit={canEdit}
              onEdit={() => setEditing(page)}
              onDelete={() => onDelete(page)}
            />
          ))}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit status page' : 'New status page'}
      >
        {editing !== null && (
          <StatusPageForm
            key={editing.id ?? 'new'}
            page={editing.id ? editing : null}
            monitors={monitors}
            wid={wid}
            submitLabel={editing.id ? 'Save changes' : 'Create page'}
            onSubmit={onSubmit}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}
