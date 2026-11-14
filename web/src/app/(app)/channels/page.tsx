import { ChatApprovalsCard } from "@/components/chat-approvals";
import { ConnectedAppsCard } from "@/components/connected-apps";
import { buttonClass, Card } from "@/components/ui";
import { TelegramCard } from "@/components/telegram-card";
import { ConnectedApps, PageHeader } from "@/components/wallet-parts";

const MCP_URL = `${(process.env.APP_URL || "https://wurapay.xyz").replace(/\/+$/, "")}/mcp`;

// Opens Claude's "Add custom connector" dialog with name and URL filled in.
// The user still reviews and confirms there (claude.com/docs/connectors/building/directory-vs-custom).
const ADD_TO_CLAUDE = `https://claude.ai/customize/connectors?${new URLSearchParams({
  modal: "add-custom-connector",
  connectorName: "Wura",
  connectorUrl: MCP_URL,
})}`;

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
          <p>This web app and Claude are live. Add Wura to Claude in one step: the button opens Claude with the details filled in, and you confirm there.</p>
          <a href={ADD_TO_CLAUDE} target="_blank" rel="noopener noreferrer" className={buttonClass("blue", "md", "w-fit")}>
            Add to Claude
          </a>
          <p className="text-[13px]">
            Or add it by hand: Settings → Connectors → Add custom connector, then paste{" "}
            <span className="break-all font-mono text-[12.5px] text-blue">{MCP_URL}</span>
          </p>
          <p>For now Claude can check your balance, rates and favourites. Preparing payments from Claude comes next. Telegram can be connected below once it’s set up on this server. ChatGPT and WhatsApp aren’t connected yet.</p>
          <p>Each one uses the same wallet, the same limits and the same approval step. A chat app only gets a key that’s capped to your limits, and it can’t move money without your yes.</p>
        </Card>
      </div>
      <ConnectedAppsCard />
      <TelegramCard />
      <ChatApprovalsCard />
    </div>
  );
}
