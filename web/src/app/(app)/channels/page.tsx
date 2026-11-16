import { ChatApprovalsCard } from "@/components/chat-approvals";
import { ConnectedAppsCard } from "@/components/connected-apps";
import { Card } from "@/components/ui";
import { TelegramCard } from "@/components/telegram-card";
import { WhatsAppCard } from "@/components/whatsapp-card";
import { ConnectedApps, PageHeader } from "@/components/wallet-parts";

export default function ChannelsPage() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Channels" sub="One assistant, wherever you already chat." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <Card className="p-6 shadow-soft sm:p-7">
          <h2 className="mb-4 text-[20px] font-bold tracking-[-0.03em]">Apps</h2>
          <ConnectedApps big />
        </Card>
        <Card className="flex flex-col gap-3 p-6 text-[14.5px] text-muted shadow-soft sm:p-7">
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-blue">What’s live</h2>
          <p>Every app uses the same wallet and limits, and none can move money without your yes.</p>
        </Card>
      </div>
      <ConnectedAppsCard />
      <TelegramCard />
      <WhatsAppCard />
      <ChatApprovalsCard />
    </div>
  );
}
