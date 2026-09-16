import { useEffect, useState } from "react";

import { api, type Bot } from "@/state/store";

interface OrgoComputerChoice {
  computerId: string;
  name: string;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  available: boolean;
}

interface OrgoComputerInventory {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: OrgoComputerChoice[];
}

export function OrgoComputerPicker({
  bot,
  onChange,
  compact = false,
}: {
  bot: Bot;
  onChange: (patch: { orgoComputerId: string | null; computer: "cloud"; cloudBackend: "orgo" }) => void;
  compact?: boolean;
}) {
  const [inventory, setInventory] = useState<OrgoComputerInventory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    void api("/api/orgo/computers")
      .then((result: OrgoComputerInventory) => { if (alive) setInventory(result); })
      .catch((caught) => { if (alive) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { alive = false; };
  }, [bot.id, bot.orgoComputerId]);

  const unavailable = !inventory?.configured || inventory.available === false;
  const availableCount = inventory?.instances.filter((computer) => computer.available).length ?? 0;
  const requiresExistingChoice = !bot.orgoComputerId && availableCount > 0;
  return (
    <div className={compact ? "mt-2" : "mt-3 rounded-lg bg-inset px-3 py-2.5"}>
      <label className="block text-[12px] font-medium text-ink" htmlFor={`orgo-computer-${bot.id}`}>
        This agent's Orgo computer
      </label>
      <select
        id={`orgo-computer-${bot.id}`}
        value={bot.orgoComputerId ?? ""}
        disabled={bot.busy || unavailable || !inventory}
        onChange={(event) => onChange({
          orgoComputerId: event.currentTarget.value || null,
          computer: "cloud",
          cloudBackend: "orgo",
        })}
        className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-card px-2.5 py-2 text-[12px] text-ink disabled:opacity-50"
      >
        <option value="" disabled={requiresExistingChoice}>
          {requiresExistingChoice
            ? `Choose one of ${availableCount} available computers…`
            : "Automatic private computer"}
        </option>
        {(inventory?.instances ?? []).map((computer) => {
          const ownedHere = computer.ownerBotId === bot.id;
          const assignedElsewhere = Boolean(computer.ownerBotId) && !ownedHere;
          const suffix = assignedElsewhere
            ? ` — assigned to ${computer.ownerName ?? "another agent"}`
            : ` — ${computer.state}`;
          return (
            <option key={computer.computerId} value={computer.computerId} disabled={assignedElsewhere}>
              {computer.name}{suffix}
            </option>
          );
        })}
      </select>
      <div className="mt-1 text-[11px] leading-4 text-ink-secondary" aria-live="polite">
        {bot.busy
          ? "Stop this agent before changing its screen."
          : error ?? inventory?.problem ?? (!inventory
            ? "Loading Orgo computers…"
            : !inventory.configured
              ? "Connect Orgo in App Settings first."
              : requiresExistingChoice
                ? "Select an existing computer. Open Orgo Bot will not create another one."
                : "Each computer can be assigned to only one agent.")}
      </div>
    </div>
  );
}
