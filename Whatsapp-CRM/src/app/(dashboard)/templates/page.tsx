import { TemplateManager } from "@/components/settings/template-manager";

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your WhatsApp message templates. Sync from Meta to import
          approved templates, or create new ones to submit for review.
        </p>
      </div>
      <TemplateManager />
    </div>
  );
}
