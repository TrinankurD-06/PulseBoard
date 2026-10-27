import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import Button from './Button.jsx';

export function CopyButton({ text, label, onCopied }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={copy} aria-label={label}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** Hairline code block with a copy button, for setup snippets. */
export default function CodeBlock({ code, label, onCopied }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-card border border-line bg-surface p-4 pr-28 font-mono text-xs leading-relaxed text-muted">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2.5 right-2.5">
        <CopyButton text={code} label={`Copy ${label}`} onCopied={onCopied} />
      </div>
    </div>
  );
}
