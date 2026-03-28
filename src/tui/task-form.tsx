import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Task } from "./backlog.js";

interface TaskFormProps {
  initial?: Partial<Task>;
  onSave: (data: { title: string; description: string }) => void;
  onCancel: () => void;
}

type Field = "title" | "description";

export function TaskForm({ initial, onSave, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [field, setField] = useState<Field>("title");

  const current = field === "title" ? title : description;
  const setCurrent = field === "title" ? setTitle : setDescription;

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }

    if (key.tab) {
      setField((f) => (f === "title" ? "description" : "title"));
      return;
    }

    if (key.return) {
      if (!title.trim()) return;
      onSave({ title: title.trim(), description: description.trim() });
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

      <Box marginTop={1}>
        <Text dimColor>[tab] next field  [enter] save  [esc] cancel</Text>
      </Box>
    </Box>
  );
}
