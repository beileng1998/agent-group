import type { AutomationDefinition, AutomationWorktreeMode } from "@agent-group/contracts";

import { AutomationModelPicker } from "../-automations.shared";
import {
  datetimeLocalFromIso,
  isoFromDatetimeLocal,
  maxIterationOptions,
  SCHEDULE_KIND_OPTIONS,
  scheduleFromKind,
  scheduleKindFromSchedule,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
} from "../-automations.shared";
import { resolveThreadPickerTitle } from "../-chatThreadRoute.logic";
import {
  completionPolicyFromStopWhen,
  stopWhenFromCompletionPolicy,
} from "~/lib/automationCompletionPolicy";
import { CentralIcon } from "~/lib/central-icons";

import {
  DetailGroup,
  DetailRow,
  EditRow,
  InlineCommitTextInput,
  INLINE_CONTROL_CLASS,
  InlineSelect,
  InlineTime,
  ModelOptionRows,
} from "./AutomationDetailControls";
import { intervalOptions, WORKTREE_OPTIONS } from "./automationDetailValues";
import type { LoadedAutomationDetailController } from "./useAutomationDetailController";

export function AutomationDefinitionDetails({
  controller,
}: {
  readonly controller: LoadedAutomationDetailController;
}) {
  const { definition, project, projects, sourceThread, targetThread, patch } = controller;
  const schedule = definition.schedule;
  const stopWhen = stopWhenFromCompletionPolicy(definition.completionPolicy ?? { type: "none" });

  return (
    <DetailGroup title="Details">
      {definition.mode === "heartbeat" ? (
        <DetailRow label="Runs in">Thread</DetailRow>
      ) : (
        <EditRow
          label={
            <>
              Runs in
              <CentralIcon
                name="info-simple"
                className="size-3 text-muted-foreground/60"
                aria-label="Where the automation runs: a worktree, a local checkout, or auto"
              />
            </>
          }
        >
          <InlineSelect
            value={definition.worktreeMode}
            options={WORKTREE_OPTIONS}
            onChange={(value) => controller.setWorktreeMode(value as AutomationWorktreeMode)}
          />
        </EditRow>
      )}
      {definition.mode === "heartbeat" ? (
        <DetailRow label="Project">{project?.name ?? "Unknown project"}</DetailRow>
      ) : (
        <EditRow label="Project">
          <InlineSelect
            value={definition.projectId}
            options={projects.map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={(value) => patch({ projectId: value as AutomationDefinition["projectId"] })}
          />
        </EditRow>
      )}
      {definition.sourceThreadId ? (
        <DetailRow label="Created from">
          {sourceThread ? (
            <button
              type="button"
              onClick={() => controller.navigateToThread(sourceThread.id)}
              className="min-w-0 truncate text-right text-foreground transition-colors hover:text-primary"
            >
              {resolveThreadPickerTitle(sourceThread.title)}
            </button>
          ) : (
            "Thread unavailable"
          )}
        </DetailRow>
      ) : null}
      <EditRow label="Repeats">
        <InlineSelect
          value={scheduleKindFromSchedule(schedule)}
          options={SCHEDULE_KIND_OPTIONS}
          onChange={(value) =>
            patch({
              schedule: scheduleFromKind(
                value as (typeof SCHEDULE_KIND_OPTIONS)[number]["value"],
                schedule,
              ),
            })
          }
        />
      </EditRow>
      {schedule.type === "interval" && schedule.everySeconds !== 3600 ? (
        <EditRow label="Every">
          <InlineSelect
            value={String(schedule.everySeconds)}
            options={intervalOptions(schedule.everySeconds)}
            onChange={(value) =>
              patch({ schedule: { type: "interval", everySeconds: Number.parseInt(value, 10) } })
            }
          />
        </EditRow>
      ) : null}
      {schedule.type === "once" ? (
        <EditRow label="Run at">
          <input
            type="datetime-local"
            value={datetimeLocalFromIso(schedule.runAt)}
            onChange={(event) =>
              event.target.value
                ? patch({
                    schedule: { type: "once", runAt: isoFromDatetimeLocal(event.target.value) },
                  })
                : undefined
            }
            className={INLINE_CONTROL_CLASS}
          />
        </EditRow>
      ) : null}
      {schedule.type === "cron" ? (
        <EditRow label="Cron">
          <InlineCommitTextInput
            value={schedule.expression}
            onCommit={(value) =>
              patch({ schedule: { type: "cron", expression: value, timezone: schedule.timezone } })
            }
            className="font-mono"
          />
        </EditRow>
      ) : null}
      {schedule.type === "daily" || schedule.type === "weekdays" ? (
        <EditRow label="Time">
          <InlineTime
            value={schedule.timeOfDay}
            onChange={(value) =>
              value ? patch({ schedule: { ...schedule, timeOfDay: value } }) : undefined
            }
          />
        </EditRow>
      ) : null}
      {schedule.type === "weekly" ? (
        <>
          <EditRow label="Day">
            <InlineSelect
              value={String(schedule.dayOfWeek)}
              options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                value: String(day),
                label: weekdayLabel(day),
              }))}
              onChange={(value) =>
                patch({ schedule: updateWeeklyScheduleDay(schedule, Number.parseInt(value, 10)) })
              }
            />
          </EditRow>
          <EditRow label="Time">
            <InlineTime
              value={schedule.timeOfDay}
              onChange={(value) =>
                value ? patch({ schedule: updateWeeklyScheduleTime(schedule, value) }) : undefined
              }
            />
          </EditRow>
        </>
      ) : null}
      {(schedule.type === "daily" ||
        schedule.type === "weekdays" ||
        schedule.type === "weekly" ||
        schedule.type === "cron") &&
      schedule.timezone ? (
        <EditRow label="Timezone">
          <InlineCommitTextInput
            value={schedule.timezone}
            onCommit={(value) => patch({ schedule: { ...schedule, timezone: value } })}
          />
        </EditRow>
      ) : null}
      <EditRow label="Model">
        <AutomationModelPicker
          value={definition.modelSelection}
          projectCwd={project?.cwd ?? null}
          onChange={controller.applyModelSelection}
        />
      </EditRow>
      <ModelOptionRows
        modelSelection={definition.modelSelection}
        onChange={controller.applyModelSelection}
      />
      <DetailRow label="Mode">
        {definition.mode === "heartbeat" ? "Heartbeat" : "Standalone"}
      </DetailRow>
      {definition.mode === "heartbeat" ? (
        <EditRow label="Stop when">
          <InlineCommitTextInput
            value={stopWhen}
            placeholder="Never"
            onCommit={(value) => patch({ completionPolicy: completionPolicyFromStopWhen(value) })}
          />
        </EditRow>
      ) : null}
      <EditRow label="Max iterations">
        <InlineSelect
          value={definition.maxIterations == null ? "" : String(definition.maxIterations)}
          options={maxIterationOptions(definition.maxIterations)}
          onChange={(value) =>
            patch({ maxIterations: value === "" ? null : Number.parseInt(value, 10) })
          }
        />
      </EditRow>
      {definition.mode === "heartbeat" ? (
        <DetailRow label="Thread">
          {targetThread ? resolveThreadPickerTitle(targetThread.title) : "Thread unavailable"}
        </DetailRow>
      ) : null}
    </DetailGroup>
  );
}
