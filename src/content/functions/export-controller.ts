import type { AccountState } from '../../billing/client';
import { FREE } from '../../billing/entitlement';
import {
  type ExportFile,
  type ExportFormat,
  serializeFunctionExport,
} from '../../features/function-export';
import { getFeature, isFeatureAvailable } from '../../features/registry';
import type { CrmContext } from './crm-context';
import type { ExportLoadResult, ExportProgress } from './export-loader';

export type ExportState =
  | { status: 'checking-entitlement'; format: ExportFormat }
  | { status: 'loading'; format: ExportFormat; loaded: number; total: number }
  | {
      status: 'complete';
      format: ExportFormat;
      count: number;
      total: number;
      skipped: number;
      filename: string;
    }
  | { status: 'upgrade-required'; format: ExportFormat }
  | { status: 'error'; format: ExportFormat; message: string };
export interface ExportDependencies {
  getEntitlement(): Promise<AccountState>;
  load(
    context: CrmContext,
    progress: (value: ExportProgress) => void,
    signal: AbortSignal,
  ): Promise<ExportLoadResult>;
  download(file: ExportFile): void;
  upgradeRequired(): void;
  state(value: ExportState): void;
  contextIsCurrent(): boolean;
  now(): string;
}
/** Billing receives no org, source or metadata; only the local Zoho loader gets context. */
export async function runFunctionExport(
  context: CrmContext,
  format: ExportFormat,
  deps: ExportDependencies,
  signal: AbortSignal,
): Promise<void> {
  try {
    deps.state({ status: 'checking-entitlement', format });
    let account: AccountState;
    try {
      account = await deps.getEntitlement();
      if (account.signedOutPending) account = await deps.getEntitlement();
    } catch {
      account = { signedIn: false, entitlement: FREE };
    }
    signal.throwIfAborted();
    if (!deps.contextIsCurrent()) throw new Error('Functions page changed');
    if (
      !isFeatureAvailable(
        getFeature('exportFunctions'),
        account.signedIn ? account.entitlement : FREE,
      )
    ) {
      deps.state({ status: 'upgrade-required', format });
      deps.upgradeRequired();
      return;
    }
    const { records, skipped } = await deps.load(
      context,
      (progress) => deps.state({ status: 'loading', format, ...progress }),
      signal,
    );
    signal.throwIfAborted();
    if (!deps.contextIsCurrent()) throw new Error('Functions page changed');
    if (!records.length) throw new Error('No function sources could be read');
    const file = serializeFunctionExport(
      records,
      format,
      {
        orgId: context.orgId,
        exportedAt: deps.now(),
      },
      skipped,
    );
    deps.download(file);
    deps.state({
      status: 'complete',
      format,
      count: records.length,
      total: records.length + skipped.length,
      skipped: skipped.length,
      filename: file.filename,
    });
  } catch {
    // Do not expose raw Zoho responses, function source or credentials in UI/events.
    deps.state({
      status: 'error',
      format,
      message: 'Export stopped. No file was downloaded. Check the Functions page and try again.',
    });
  }
}
