import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allHookNames,
  assertFakeChildrenReaped,
  assertNoUnexpectedFakeCommands,
  assertNonDefaultBaseSemantics,
  assertRuntimeResponse,
  cleanupRuntimeRepository,
  commandFor,
  createRuntimeContext,
  deleteGeneratedEntrypoint,
  dispatchLogs,
  executeProjectedHook,
  fakeCommandLogs,
  irrelevantCommandFor,
  malformedCommandFor,
  mutateGate,
  overwriteGeneratedEntrypoint,
  overwriteCommitMessage,
  payloadFor,
  prepareRuntimeMode,
  redirectGeneratedRoute,
  reviewerCommandFor,
  writeActiveGitMarker,
  writeReviewerPayload,
} from "./harness.js";
import type { Host, HookName, RuntimeContext, RuntimeMode } from "./types.js";

const hosts: Host[] = ["cursor", "codex"];
const preHooks = allHookNames.filter((hook) => hook !== "post-merge");

const withRuntimeRepository = (callback: (context: RuntimeContext) => void) => {
  const context = createRuntimeContext();
  try {
    callback(context);
  } finally {
    cleanupRuntimeRepository(context);
  }
};

const expectRuntimeFailure = (callback: () => void, message: RegExp) => {
  expect(callback).toThrow(message);
};

const implementationCheckoutRoot = execFileSync(
  "git",
  ["rev-parse", "--show-toplevel"],
  { cwd: process.cwd(), encoding: "utf8" },
).trim();

const implementationCheckoutSnapshot = () => ({
  head: execFileSync("git", ["-C", implementationCheckoutRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync(
    "git",
    ["-C", implementationCheckoutRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  ),
  tracked: execFileSync("git", ["-C", implementationCheckoutRoot, "ls-files", "-z"], { encoding: "utf8" }),
});

describe.sequential("executable generated project-hook runtime oracle", () => {
  for (const hook of allHookNames) {
    it(`${hook} executes irrelevant and protected paths through both generated hosts`, () => {
      withRuntimeRepository((context) => {
        for (const host of hosts) {
          prepareRuntimeMode(context, hook, "irrelevant");
          const irrelevant = executeProjectedHook(
            context,
            host,
            hook,
            "irrelevant",
            payloadFor(host, irrelevantCommandFor(hook), context.repositoryRoot, hook === "post-merge"),
          );
        assertRuntimeResponse(irrelevant, true, false);
          expect(irrelevant.dispatches).toEqual([
            { checker: null, operation: null, decision: hook === "post-merge" ? "irrelevant" : "allow" },
          ]);
          assertNoUnexpectedFakeCommands(context);

          if (hook === "post-merge") {
            prepareRuntimeMode(context, hook, "allow");
            const relevant = executeProjectedHook(
              context,
              host,
              hook,
              "allow",
              payloadFor(host, commandFor(context, hook), context.repositoryRoot, true),
            );
            assertRuntimeResponse(relevant, true, true);
            expect(relevant.dispatches).toEqual([
              { checker: "post-merge.mjs", operation: "merge", decision: "route" },
            ]);
            assertNoUnexpectedFakeCommands(context);
            continue;
          }

          prepareRuntimeMode(context, hook, "missing-gate");
          const denied = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          expect(denied.dispatches).toEqual([
            { checker: `${hook}.mjs`, operation: hook === "pre-pr-create" ? "pr-create" : hook === "pre-review-submit" ? "review" : hook === "pre-pr-ready" ? "ready" : hook === "pre-rebase" ? "rebase" : hook.replace("pre-", ""), decision: "route" },
          ]);
          assertNoUnexpectedFakeCommands(context);

          prepareRuntimeMode(context, hook, "allow");
          const allowed = executeProjectedHook(
            context,
            host,
            hook,
            "allow",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(allowed, true);
          expect(allowed.dispatches).toEqual([
            { checker: `${hook}.mjs`, operation: hook === "pre-pr-create" ? "pr-create" : hook === "pre-review-submit" ? "review" : hook === "pre-pr-ready" ? "ready" : hook === "pre-rebase" ? "rebase" : hook.replace("pre-", ""), decision: "route" },
          ]);
          if (hook === "pre-merge") {
            expect(fakeCommandLogs(context).some((entry) => entry.executable === "gh")).toBe(false);
          }
          assertNoUnexpectedFakeCommands(context);
        }
      });
    }, 30_000);
  }

  it("fails closed on stale snapshot evidence without any live GitHub call", () => {
    withRuntimeRepository((context) => {
      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-merge", "allow");
        mutateGate(context, "pre-merge", (gate) => {
          const readiness = gate.readiness as Record<string, unknown>;
          const snapshot = readiness.readiness_evidence as Record<string, unknown>;
          const freshness = snapshot.freshness as Record<string, unknown>;
          freshness.status = "stale";
        });
        const denied = executeProjectedHook(
          context,
          host,
          "pre-merge",
          "allow",
          payloadFor(host, commandFor(context, "pre-merge"), context.repositoryRoot),
        );
        assertRuntimeResponse(denied, false);
        expect(fakeCommandLogs(context).some((entry) => entry.executable === "gh")).toBe(false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  });

  it("fails closed for malformed object payloads and compound commands", () => {
    withRuntimeRepository((context) => {
      for (const host of hosts) {
        for (const hook of preHooks) {
          prepareRuntimeMode(context, hook, "missing-gate");
          const missingCommand = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            host === "cursor"
              ? { hook_event_name: "beforeShellExecution", cwd: context.repositoryRoot }
              : { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { cwd: context.repositoryRoot } },
          );
          assertRuntimeResponse(missingCommand, false);

          prepareRuntimeMode(context, hook, "missing-gate");
          const compound = executeProjectedHook(
            context,
            host,
            hook,
            "missing-gate",
            payloadFor(host, malformedCommandFor(hook), context.repositoryRoot),
          );
          assertRuntimeResponse(compound, false);
          assertNoUnexpectedFakeCommands(context);
        }
      }

      prepareRuntimeMode(context, "post-merge", "allow");
      for (const host of hosts) {
        const malformedPost = executeProjectedHook(
          context,
          host,
          "post-merge",
          "allow",
          host === "cursor"
            ? { hook_event_name: "afterShellExecution", cwd: context.repositoryRoot }
            : { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { cwd: context.repositoryRoot } },
        );
        assertRuntimeResponse(malformedPost, true, false);
      }
    });
  }, 30_000);

  it("does not misclassify quoted text and rejects compound protected commands before live work", () => {
    withRuntimeRepository((context) => {
      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-commit", "missing-gate");
        const quoted = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "missing-gate",
          payloadFor(host, 'echo "git commit --file=runtime.txt" && printf "gh pr merge"', context.repositoryRoot),
        );
        assertRuntimeResponse(quoted, true);
        expect(quoted.dispatches).toEqual([{ checker: null, operation: null, decision: "allow" }]);
        expect(quoted.logs).toEqual([]);

        prepareRuntimeMode(context, "pre-commit", "missing-gate");
        const compound = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "missing-gate",
          payloadFor(
            host,
            `${commandFor(context, "pre-commit")} && ${commandFor(context, "pre-merge")}`,
            context.repositoryRoot,
          ),
        );
        assertRuntimeResponse(compound, false);
        expect(compound.dispatches).toEqual([{ checker: null, operation: null, decision: "deny" }]);
        expect(compound.logs).toEqual([]);
      }
    });
  });

  it("binds Ready-for-Review and requested-reviewers operations exactly on both hosts", () => {
    withRuntimeRepository((context) => {
      const canonicalReady = commandFor(context, "pre-pr-ready");
      const canonicalReviewers = reviewerCommandFor(context);

      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-pr-ready", "allow");
        const ready = executeProjectedHook(
          context,
          host,
          "pre-pr-ready",
          "allow",
          payloadFor(host, canonicalReady, context.repositoryRoot),
        );
        assertRuntimeResponse(ready, true);
        assertNoUnexpectedFakeCommands(context);

        for (const command of [
          `gh pr ready ${context.pullRequestUrl} --repo ${context.repository}`,
          `gh pr ready ${context.pullRequestNumber} --repo=${context.repository}`,
          `gh pr ready ${context.pullRequestNumber} --repo ${context.repository} --undo`,
          `env ${canonicalReady}`,
          `${canonicalReady} && echo unsupported`,
          `echo unsupported && ${canonicalReady}`,
          `${canonicalReady} | echo unsupported`,
        ]) {
          prepareRuntimeMode(context, "pre-pr-ready", "allow");
          const denied = executeProjectedHook(
            context,
            host,
            "pre-pr-ready",
            "allow",
            payloadFor(host, command, context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);
        }

        prepareRuntimeMode(context, "pre-pr-ready", "reviewer-allow");
        mutateGate(context, "pre-pr-ready", (gate) => {
          gate.reviewers = {
            add: [
              { kind: "user", login: "octocat" },
              { kind: "team", login: `${context.repository.split("/")[0]}/docs` },
            ],
          };
        });
        writeReviewerPayload(context, {
          reviewers: ["octocat"],
          team_reviewers: ["docs"],
        });
        const reviewerAllowed = executeProjectedHook(
          context,
          host,
          "pre-pr-ready",
          "reviewer-allow",
          payloadFor(host, canonicalReviewers, context.repositoryRoot),
        );
        assertRuntimeResponse(reviewerAllowed, true);
        assertNoUnexpectedFakeCommands(context);

        for (const payload of [
          { reviewers: [], team_reviewers: ["docs"] },
          { reviewers: ["octocat", "octocat"], team_reviewers: ["docs"] },
          { reviewers: ["octocat"], team_reviewers: ["other-team"] },
          { reviewers: ["octocat"], team_reviewers: ["docs"], extra: true },
        ]) {
          prepareRuntimeMode(context, "pre-pr-ready", "reviewer-allow");
          mutateGate(context, "pre-pr-ready", (gate) => {
            gate.reviewers = {
              add: [
                { kind: "user", login: "octocat" },
                { kind: "team", login: `${context.repository.split("/")[0]}/docs` },
              ],
            };
          });
          writeReviewerPayload(context, payload);
          const denied = executeProjectedHook(
            context,
            host,
            "pre-pr-ready",
            "reviewer-allow",
            payloadFor(host, canonicalReviewers, context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);
        }

        for (const command of [
          `gh api repos/${context.repository}/pulls/${context.pullRequestNumber}/requested_reviewers --method DELETE --input ${context.reviewPayloadPath}`,
          `gh api repos/${context.repository}/pulls/${context.pullRequestNumber}/requested_reviewers --method POST --field reviewers=octocat`,
          `gh api /repos/${context.repository}/pulls/${context.pullRequestNumber}/requested_reviewers --method POST --input ${context.reviewPayloadPath}`,
          `${canonicalReviewers} && echo unsupported`,
        ]) {
          prepareRuntimeMode(context, "pre-pr-ready", "reviewer-allow");
          mutateGate(context, "pre-pr-ready", (gate) => {
            gate.reviewers = { add: [{ kind: "user", login: "octocat" }] };
          });
          writeReviewerPayload(context, { reviewers: ["octocat"], team_reviewers: [] });
          const denied = executeProjectedHook(
            context,
            host,
            "pre-pr-ready",
            "reviewer-allow",
            payloadFor(host, command, context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);
        }

        prepareRuntimeMode(context, "pre-pr-ready", "reviewer-draft");
        mutateGate(context, "pre-pr-ready", (gate) => {
          gate.reviewers = { add: [{ kind: "user", login: "octocat" }] };
        });
        writeReviewerPayload(context, { reviewers: ["octocat"], team_reviewers: [] });
        const draftReviewer = executeProjectedHook(
          context,
          host,
          "pre-pr-ready",
          "reviewer-draft",
          payloadFor(host, canonicalReviewers, context.repositoryRoot),
        );
        assertRuntimeResponse(draftReviewer, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-pr-ready", "reviewer-live-drift");
        mutateGate(context, "pre-pr-ready", (gate) => {
          gate.reviewers = { add: [{ kind: "user", login: "octocat" }] };
        });
        writeReviewerPayload(context, { reviewers: ["octocat"], team_reviewers: [] });
        const driftedReviewer = executeProjectedHook(
          context,
          host,
          "pre-pr-ready",
          "reviewer-live-drift",
          payloadFor(host, canonicalReviewers, context.repositoryRoot),
        );
        assertRuntimeResponse(driftedReviewer, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-pr-ready", "allow");
        mutateGate(context, "pre-pr-ready", (gate) => {
          delete gate.schema;
        });
        const legacyGate = executeProjectedHook(
          context,
          host,
          "pre-pr-ready",
          "allow",
          payloadFor(host, canonicalReady, context.repositoryRoot),
        );
        assertRuntimeResponse(legacyGate, false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  }, 30_000);

  it("detects stale and malformed gate snapshots, unmerged index state, and active operations", () => {
    withRuntimeRepository((context) => {
      for (const hook of preHooks) {
        for (const host of hosts) {
          const mode: RuntimeMode = hook === "pre-commit" ? "stale-gate" : "malformed-gate";
          prepareRuntimeMode(context, hook, mode);
          const denied = executeProjectedHook(
            context,
            host,
            hook,
            mode,
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(denied, false);
          assertNoUnexpectedFakeCommands(context);
        }
      }

      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-commit", "unmerged-index");
        const unmerged = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "unmerged-index",
          payloadFor(host, commandFor(context, "pre-commit"), context.repositoryRoot),
        );
        assertRuntimeResponse(unmerged, false);

        prepareRuntimeMode(context, "pre-rebase", "active-operation");
        writeActiveGitMarker(context);
        const active = executeProjectedHook(
          context,
          host,
          "pre-rebase",
          "active-operation",
          payloadFor(host, commandFor(context, "pre-rebase"), context.repositoryRoot),
        );
        assertRuntimeResponse(active, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-rebase", "mismatched-gate");
        const mismatched = executeProjectedHook(
          context,
          host,
          "pre-rebase",
          "mismatched-gate",
          payloadFor(host, commandFor(context, "pre-rebase"), context.repositoryRoot),
        );
        assertRuntimeResponse(mismatched, false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  }, 45_000);

  it("binds pre-commit to the exact command, message bytes, and staged index on both hosts", () => {
    withRuntimeRepository((context) => {
      const approvedMessage = readFileSync(context.messagePath, "utf8");
      const canonicalCommand = commandFor(context, "pre-commit");

      for (const host of hosts) {
        prepareRuntimeMode(context, "pre-commit", "allow");
        const allowed = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "allow",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(allowed, true);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-commit", "message-source");
        const alternateSource = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "message-source",
          payloadFor(
            host,
            canonicalCommand.replace(context.messagePath, context.bodyPath),
            context.repositoryRoot,
          ),
        );
        assertRuntimeResponse(alternateSource, false);
        assertNoUnexpectedFakeCommands(context);

        prepareRuntimeMode(context, "pre-commit", "message-bytes");
        overwriteCommitMessage(context, "Runtime oracle\n\nUnexpected message bytes.\n");
        const alteredMessage = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "message-bytes",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(alteredMessage, false);
        expect(`${alteredMessage.stdout}\n${alteredMessage.stderr}`).not.toContain("Unexpected message bytes.");
        assertNoUnexpectedFakeCommands(context);
        overwriteCommitMessage(context, approvedMessage);

        prepareRuntimeMode(context, "pre-commit", "allow");
        mutateGate(context, "pre-commit", (gate) => {
          const binding = gate.commit_binding as Record<string, unknown>;
          const messageFile = binding.message_file as Record<string, unknown>;
          messageFile.sha256 = "0".repeat(64);
        });
        const alteredBinding = executeProjectedHook(
          context,
          host,
          "pre-commit",
          "allow",
          payloadFor(host, canonicalCommand, context.repositoryRoot),
        );
        assertRuntimeResponse(alteredBinding, false);
        assertNoUnexpectedFakeCommands(context);

        for (const mode of ["staged-path", "staged-mode", "staged-blob", "staged-deletion"] as const) {
          prepareRuntimeMode(context, "pre-commit", mode);
          const alteredIndex = executeProjectedHook(
            context,
            host,
            "pre-commit",
            mode,
            payloadFor(host, canonicalCommand, context.repositoryRoot),
          );
          assertRuntimeResponse(alteredIndex, false);
          assertNoUnexpectedFakeCommands(context);
        }

        for (const command of [
          `${canonicalCommand} && echo unsupported`,
          `echo unsupported && ${canonicalCommand}`,
          `${canonicalCommand} | echo unsupported`,
          `${canonicalCommand} > commit-output.txt`,
          `env ${canonicalCommand}`,
          `git -C "$(pwd)" commit --cleanup=verbatim --file="${context.messagePath}"`,
          `${canonicalCommand} -- runtime-oracle.txt`,
          `${canonicalCommand.replace("--cleanup=verbatim", "--cleanup=strip")}`,
        ]) {
          prepareRuntimeMode(context, "pre-commit", "allow");
          const deniedCommand = executeProjectedHook(
            context,
            host,
            "pre-commit",
            "allow",
            payloadFor(host, command, context.repositoryRoot),
          );
          assertRuntimeResponse(deniedCommand, false);
          expect(`${deniedCommand.stdout}\n${deniedCommand.stderr}`).not.toContain(
            "Execute generated project hooks.",
          );
          assertNoUnexpectedFakeCommands(context);
        }
      }
    });
  }, 45_000);

  it("rejects legacy, missing, and unmet explicit evidence handoffs", () => {
    withRuntimeRepository((context) => {
      for (const hook of ["pre-commit", "pre-pr-create"] as const) {
        for (const host of hosts) {
          prepareRuntimeMode(context, hook, "allow");
          mutateGate(context, hook, (gate) => {
            const validation = gate.validation as Record<string, unknown>;
            validation.version = 1;
          });
          const legacy = executeProjectedHook(
            context,
            host,
            hook,
            "allow",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(legacy, false);
          assertNoUnexpectedFakeCommands(context);

          prepareRuntimeMode(context, hook, "allow");
          mutateGate(context, hook, (gate) => {
            const validation = gate.validation as Record<string, unknown>;
            delete validation.evidence_requirements;
          });
          const missingList = executeProjectedHook(
            context,
            host,
            hook,
            "allow",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(missingList, false);
          assertNoUnexpectedFakeCommands(context);

          prepareRuntimeMode(context, hook, "allow");
          mutateGate(context, hook, (gate) => {
            const validation = gate.validation as Record<string, unknown>;
            validation.evidence_requirements = [
              {
                id: "settings-ui",
                requirement: "Provide the settings UI screenshot.",
                source: { kind: "issue", reference: "issue:42" },
                expected_kind: "ui_screenshot",
                location: "docs/ui/settings.png",
                status: "missing",
                evidence: ["The declared evidence is missing."],
              },
            ];
          });
          const unmet = executeProjectedHook(
            context,
            host,
            hook,
            "allow",
            payloadFor(host, commandFor(context, hook), context.repositoryRoot),
          );
          assertRuntimeResponse(unmet, false);
          assertNoUnexpectedFakeCommands(context);
        }
      }
    });
  }, 45_000);

  it("handles controlled GitHub CLI failures, invalid JSON, authentication failures, and bounded delays", () => {
    withRuntimeRepository((context) => {
      const cases: Array<{ hook: HookName; mode: RuntimeMode; allow: boolean }> = [
        { hook: "pre-review-submit", mode: "cli-auth-failure", allow: false },
        { hook: "pre-pr-ready", mode: "cli-invalid-json", allow: false },
        { hook: "pre-pr-ready", mode: "cli-delay", allow: true },
      ];
      for (const testCase of cases) {
        for (const host of hosts) {
          prepareRuntimeMode(context, testCase.hook, testCase.mode);
          const startedAt = Date.now();
          const execution = executeProjectedHook(
            context,
            host,
            testCase.hook,
            testCase.mode,
            payloadFor(host, commandFor(context, testCase.hook), context.repositoryRoot),
          );
          const elapsed = Date.now() - startedAt;
          assertRuntimeResponse(execution, testCase.allow);
          expect(elapsed).toBeLessThan(1_500);
          assertNoUnexpectedFakeCommands(context);
        }
      }
    });
  }, 30_000);

  it("bounds slow, hung, oversized, network-like, credential-helper, and paginated failures", () => {
    withRuntimeRepository((context) => {
      const preCases: Array<{ hook: HookName; mode: RuntimeMode }> = [
        { hook: "pre-pr-ready", mode: "cli-timeout" },
        { hook: "pre-pr-ready", mode: "cli-hang" },
        { hook: "pre-pr-ready", mode: "cli-oversized-output" },
        { hook: "pre-pr-ready", mode: "cli-network-failure" },
        { hook: "pre-commit", mode: "credential-helper-delay" },
      ];
      for (const testCase of preCases) {
        for (const host of hosts) {
          prepareRuntimeMode(context, testCase.hook, testCase.mode);
          const startedAt = Date.now();
          const execution = executeProjectedHook(
            context,
            host,
            testCase.hook,
            testCase.mode,
            payloadFor(host, commandFor(context, testCase.hook), context.repositoryRoot),
          );
          const elapsed = Date.now() - startedAt;
          assertRuntimeResponse(execution, false);
          expect(elapsed).toBeLessThan(10_000);
          expect(execution.dispatches).toEqual([
            {
              checker: `${testCase.hook}.mjs`,
              operation: testCase.hook === "pre-pr-ready" ? "ready" : testCase.hook === "pre-merge" ? "merge" : "commit",
              decision: "route",
            },
          ]);
          assertNoUnexpectedFakeCommands(context);
          if (testCase.mode === "cli-hang") assertFakeChildrenReaped(context);
        }
      }

      for (const host of hosts) {
        prepareRuntimeMode(context, "post-merge", "graphql-incomplete");
        const startedAt = Date.now();
        const execution = executeProjectedHook(
          context,
          host,
          "post-merge",
          "graphql-incomplete",
          payloadFor(host, commandFor(context, "post-merge"), context.repositoryRoot, true),
        );
        const elapsed = Date.now() - startedAt;
        assertRuntimeResponse(execution, true, true);
        expect(elapsed).toBeLessThan(10_000);
        expect(execution.dispatches).toEqual([
          { checker: "post-merge.mjs", operation: "merge", decision: "route" },
        ]);
        expect(execution.stdout.toLowerCase()).toContain("unavailable");
        assertNoUnexpectedFakeCommands(context);
      }

      expect(dispatchLogs(context)).toHaveLength(1);
    });
  }, 60_000);

  it("uses the live non-default pull-request base for merge containment", () => {
    withRuntimeRepository((original) => {
      const context = { ...original, baseBranch: "release/2.x" };
      prepareRuntimeMode(context, "post-merge", "allow");
      for (const host of hosts) {
        const execution = executeProjectedHook(
          context,
          host,
          "post-merge",
          "allow",
          payloadFor(host, commandFor(context, "post-merge"), context.repositoryRoot, true),
        );
        assertNonDefaultBaseSemantics(execution, context);
        assertNoUnexpectedFakeCommands(context);
      }
    });
  }, 30_000);

  it("detects disposable projection faults instead of accepting a broken oracle target", () => {
    const faultCases = [
      {
        name: "missing hook file",
        mutate: (context: RuntimeContext, host: Host) => deleteGeneratedEntrypoint(context, host, "pre-commit"),
        expected: /entrypoint|start/i,
      },
      {
        name: "hook cannot start",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(context, host, "pre-commit", "this is not valid JavaScript\n"),
        expected: /exit|start|abnormally/i,
      },
      {
        name: "non-JSON stdout",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(context, host, "pre-commit", "process.stdout.write('not-json\\n');\n"),
        expected: /JSON|valid/i,
      },
      {
        name: "wrong host envelope",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\n');\n"
              : "process.stdout.write(JSON.stringify({permission:'allow'})+'\\n');\n",
          ),
        expected: /keys|envelope|JSON/i,
      },
      {
        name: "wrong exit status",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({permission:'allow'})+'\\n'); process.exitCode=2;\n"
              : "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\n'); process.exitCode=2;\n",
          ),
        expected: /exit/i,
      },
      {
        name: "additional stdout",
        mutate: (context: RuntimeContext, host: Host) =>
          overwriteGeneratedEntrypoint(
            context,
            host,
            "pre-commit",
            host === "cursor"
              ? "process.stdout.write(JSON.stringify({permission:'allow'})+'\\nextra\\n');\n"
              : "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}})+'\\nextra\\n');\n",
          ),
        expected: /exactly one|JSON line/i,
      },
      {
        name: "wrong manifest checker",
        mutate: (context: RuntimeContext, host: Host) => redirectGeneratedRoute(context, host, "pre-commit", "pre-rebase"),
        expected: /routed|manifest|entrypoint/i,
      },
    ] as const;

    for (const faultCase of faultCases) {
      withRuntimeRepository((context) => {
        for (const host of hosts) {
          prepareRuntimeMode(context, "pre-commit", "allow");
          faultCase.mutate(context, host);
          const execution = executeProjectedHook(
            context,
            host,
            "pre-commit",
            "allow",
            payloadFor(host, commandFor(context, "pre-commit"), context.repositoryRoot),
          );
          expectRuntimeFailure(
            () => assertRuntimeResponse(execution, true),
            faultCase.expected,
          );
        }
      });
    }
  }, 30_000);

  it("does not rely on generated gate placeholders", () => {
    withRuntimeRepository((context) => {
      for (const hook of preHooks) {
        expect(existsSync(`${context.repositoryRoot}/.cursor/hooks/state/${hook}.json`)).toBe(false);
      }
      expect(readFileSync(`${context.repositoryRoot}/.gitignore`, "utf8")).toContain(".cursor/hooks/state/");
    });
  });

  it("leaves the implementation checkout HEAD, status, and tracked files unchanged", () => {
    const before = implementationCheckoutSnapshot();
    withRuntimeRepository((context) => {
      prepareRuntimeMode(context, "post-merge", "irrelevant");
      for (const host of hosts) {
        const execution = executeProjectedHook(
          context,
          host,
          "post-merge",
          "irrelevant",
          payloadFor(host, irrelevantCommandFor("post-merge"), context.repositoryRoot, true),
        );
        assertRuntimeResponse(execution, true, false);
        assertNoUnexpectedFakeCommands(context);
      }
    });
    expect(implementationCheckoutSnapshot()).toEqual(before);
  }, 30_000);
});
