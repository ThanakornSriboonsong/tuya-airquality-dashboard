"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeviceDto, DiscoveredDeviceDto, Placement } from "@tuya-dashboard/shared";
import { api } from "../../lib/api";
import { groupDevices } from "../../lib/group-devices";

const inputClass =
  "mt-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100";

function RegisterForm({ device }: { device: DiscoveredDeviceDto }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(device.name.trim());
  const [placement, setPlacement] = useState<Placement>("indoor");
  const [groupName, setGroupName] = useState("");
  const [roomVolume, setRoomVolume] = useState("");

  const register = useMutation({
    mutationFn: () =>
      api.registerDevice({
        deviceId: device.deviceId,
        label,
        placement,
        groupName: groupName.trim() || null,
        roomVolumeM3: roomVolume ? Number(roomVolume) : null,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", "discover"] });
      if (result.unmappedDpCodes.length > 0) {
        alert(
          `Registered, but ${result.unmappedDpCodes.length} DP code(s) weren't recognized: ` +
            `${result.unmappedDpCodes.join(", ")}. Add them to dp-metric-map.ts to track those too.`,
        );
      }
    },
  });

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{device.name.trim() || device.deviceId}</span>
        <span className="text-xs text-neutral-500">{device.category}</span>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        {device.dataPoints.length} DP code(s) available · {device.deviceId}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-neutral-400">
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Group
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="optional"
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Placement
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as Placement)}
            className={inputClass}
          >
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </label>
        {placement === "indoor" && (
          <label className="flex flex-col text-xs text-neutral-400">
            Room volume (m³)
            <input
              value={roomVolume}
              onChange={(e) => setRoomVolume(e.target.value)}
              placeholder="optional"
              className={`${inputClass} w-28`}
            />
          </label>
        )}
        <button
          onClick={() => register.mutate()}
          disabled={register.isPending || !label}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {register.isPending ? "Registering…" : "Add device"}
        </button>
      </div>
      {register.isError && (
        <p className="mt-2 text-xs text-red-400">{(register.error as Error).message}</p>
      )}
    </div>
  );
}

function EditDeviceForm({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(device.label);
  const [placement, setPlacement] = useState<Placement>(device.placement);
  const [groupName, setGroupName] = useState(device.groupName ?? "");
  const [roomVolume, setRoomVolume] = useState(
    device.roomVolumeM3 === null ? "" : String(device.roomVolumeM3),
  );

  const save = useMutation({
    mutationFn: () =>
      api.updateDevice(device.id, {
        label: label.trim(),
        placement,
        groupName: groupName.trim() || null,
        roomVolumeM3: roomVolume ? Number(roomVolume) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["readings", "latest"] });
      onDone();
    },
  });

  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-neutral-400">
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Group
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Ungrouped"
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-400">
          Placement
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as Placement)}
            className={inputClass}
          >
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </label>
        {placement === "indoor" && (
          <label className="flex flex-col text-xs text-neutral-400">
            Room volume (m³)
            <input
              value={roomVolume}
              onChange={(e) => setRoomVolume(e.target.value)}
              placeholder="optional"
              className={`${inputClass} w-28`}
            />
          </label>
        )}
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !label.trim()}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onDone}
          className="rounded border border-neutral-700 px-4 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-600">{device.id}</p>
      {save.isError && (
        <p className="mt-2 text-xs text-red-400">{(save.error as Error).message}</p>
      )}
    </div>
  );
}

function DeviceRow({ device }: { device: DeviceDto }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded border border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-2 text-sm">
        <span>{device.label}</span>
        <div className="flex items-center gap-3">
          <span className="text-neutral-500">{device.placement}</span>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      {editing && <EditDeviceForm device={device} onDone={() => setEditing(false)} />}
    </li>
  );
}

export default function DevicesPage() {
  const registeredQuery = useQuery({ queryKey: ["devices"], queryFn: api.listDevices });
  const discoverQuery = useQuery({
    queryKey: ["devices", "discover"],
    queryFn: api.discoverDevices,
  });

  const unregistered = discoverQuery.data?.filter((d) => !d.isRegistered) ?? [];
  const groups = groupDevices(registeredQuery.data ?? []);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-2 text-xl font-semibold">Devices</h1>
      <p className="mb-6 text-sm text-neutral-500">
        New air-quality devices are picked up automatically — link them to your Cloud
        project&apos;s app account, then add them here. DP codes are read live from the device,
        not hardcoded.
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">Registered</h2>
        {groups.length ? (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.name}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-600">
                  {group.name}
                </h3>
                <ul className="space-y-2">
                  {group.devices.map((d) => (
                    <DeviceRow key={d.id} device={d} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No devices registered yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Available in your account
        </h2>
        {discoverQuery.isLoading && (
          <p className="text-sm text-neutral-500">Discovering devices…</p>
        )}
        {discoverQuery.isError && (
          <p className="text-sm text-red-400">{(discoverQuery.error as Error).message}</p>
        )}
        {unregistered.length === 0 && discoverQuery.isSuccess && (
          <p className="text-sm text-neutral-500">
            Nothing new — every discovered device is already registered.
          </p>
        )}
        <div className="space-y-3">
          {unregistered.map((d) => (
            <RegisterForm key={d.deviceId} device={d} />
          ))}
        </div>
      </section>
    </main>
  );
}
