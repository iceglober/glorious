import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Task } from "./backlog.js";

interface TaskFormProps {
  initial?: Partial<Task>;
  onSave: (data: { title: string; description: string; dependencies?: string[] }) => void;
  onCancel: () => void;
}

type Field = "title" | "description" | "deps";

const FIELDS: Field[] = ["title", "description", "deps"];

export function TaskForm({ initial, onSave, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [deps, setDeps] = useState((initial?.dependencies ?? []).join(", "));
  const [field, setField] = useState<Field>("title");

  const current = field === "title" ? title : field === "description" ? description : deps;
  const setCurrent = field === "title" ? setTitle : field === "description" ? setDescription : setDeps;

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }

    if (key.tab) {
      setField((f) => FIELDS[(FIELDS.indexOf(f) + 1) % FIELDS.length]);
      return;
    }

    if (key.return) {
      if (!title.trim()) return;
      const parsedDeps = deps.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      onSave({ title: title.trim(), description: description.trim(), dependencies: parsedDeps.length > 0 ? parsedDeps : undefined });
      return;
    }

    if (key.backspace || key.delete) {
      setCurrent((v: string) => v.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setCurrent((v: string) => v + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
      <Text bold color="cyan">{initial?.title ? "Edit task" : "Add task"}</Text>

      <Box marginTop={1}>
        <Text bold={field === "title"} color={field === "title" ? "cyan" : undefined}>Title: </Text>
        <Text>{title}{field === "title" ? "█" : ""}</Text>
      </Box>

      <Box>
        <Text bold={field === "description"} color={field === "description" ? "cyan" : undefined}>Desc:  </Text>
        <Text>{description}{field === "description" ? "█" : ""}</Text>
      </Box>

      <Box>
        <Text bold={field === "deps"} color={field === "deps" ? "cyan" : undefined}>Deps:  </Text>
        <Text>{deps}{field === "deps" ? "█" : ""}</Text>
        {field === "deps" && <Text dimColor> (comma-separated task IDs, e.g. t1, t2)</Text>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[tab] next field  [enter] save  [esc] cancel</Text>
      </Box>
    </Box>
  );
}
