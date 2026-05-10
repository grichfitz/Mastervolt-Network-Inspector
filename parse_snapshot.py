import json
import math
import sys
import xml.etree.ElementTree as ET


def strip_namespace(root):
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]


def get_child_text(parent, tag_name, default=""):
    """Safely read child text."""
    if parent is None:
        return default
    child = parent.find(tag_name)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def to_int(value, default=None):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def to_float(value, default=None):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def normalize_stepsize(stepsize):
    """Remove floating-point noise from stepsize."""
    if stepsize is None or not math.isfinite(stepsize):
        return None
    return round(stepsize, 10)


def decimals_from_stepsize(stepsize):
    """Determine decimals from normalized stepsize."""
    if stepsize is None or stepsize <= 0:
        return 0
    text = f"{stepsize:.10f}".rstrip("0").rstrip(".")
    if "." not in text:
        return 0
    return len(text.split(".", 1)[1])


def load_strings_map(root):
    strings_map = {}
    strings_node = root.find("strings")
    if strings_node is None:
        return strings_map

    for string_node in strings_node.findall("string"):
        number = to_int(string_node.get("number"))
        if number is None:
            continue
        value = (string_node.text or "").strip()
        strings_map[number] = value
    return strings_map


def pick_best_group(group_labels):
    if not group_labels:
        return None

    # Prefer most specific groups (Cell-level)
    for g in group_labels:
        if g and "cell" in g.lower():
            return g

    # Fallback to last group if no better match
    return group_labels[-1]


def resolve_type(visualization_type, section_name):
    if visualization_type == 1:
        return "numeric"
    # Large counters / durations (common on Li-ion history + some monitoring slots)
    if visualization_type in (7, 8):
        return "numeric"
    if visualization_type == 3:
        return "enum"
    if visualization_type == 5:
        return "boolean"
    if visualization_type == 6:
        return "string"
    if visualization_type == 4 and section_name == "alarm":
        return "boolean"
    return None


def parse_numeric_value(variable):
    value_text = get_child_text(variable, "value", "")
    nan_flag = to_int(get_child_text(variable, "NAN", "0"), 0)

    if value_text.upper() == "NAN" or nan_flag == 1:
        return None

    raw_value = to_float(value_text)
    if raw_value is None:
        return None

    stepsize = normalize_stepsize(to_float(get_child_text(variable, "stepsize", "")))
    decimals = decimals_from_stepsize(stepsize)
    return round(raw_value, decimals)


def parse_enum_value(variable, strings_map):
    raw = to_int(get_child_text(variable, "value", ""))
    if raw is None:
        return None

    for item in variable.findall(".//item"):
        item_index = to_int(item.get("index"))
        if item_index != raw:
            continue

        string_id = to_int((item.text or "").strip())
        if string_id is None:
            return None
        return strings_map.get(string_id)

    return None


def parse_boolean_value(variable):
    return get_child_text(variable, "value", "") == "1"


def parse_string_value(variable, strings_map):
    value_id = to_int(get_child_text(variable, "value", ""))
    if value_id is None:
        return None
    return strings_map.get(value_id)


def build_group_map_for_section(section_elem, strings_map):
    """Groups under configuration must not overwrite telemetry grouping."""
    group_map = {}
    groups_parent = section_elem.find("groups")
    if groups_parent is None:
        return group_map

    for group in groups_parent.findall("group"):
        string_id = to_int(get_child_text(group, "stringID", ""))
        group_label = strings_map.get(string_id)

        for item in group.findall("item"):
            var_index = to_int((item.text or "").strip())
            if var_index is not None:
                if var_index not in group_map:
                    group_map[var_index] = []
                group_map[var_index].append(group_label)
    return group_map


def resolve_serial_number(strings_map, general_string_el):
    raw = get_child_text(general_string_el, "SerialNumber", "")
    if not general_string_el:
        return None

    sid = to_int(raw)
    if sid is not None and sid in strings_map:
        text = strings_map.get(sid)
        if text:
            return text

    return raw or strings_map.get(0)


def resolve_product_name_string(strings_map, general_string_el):
    if not general_string_el:
        return None
    pn_ref = to_int(get_child_text(general_string_el, "ProductName", ""))
    if pn_ref is None:
        return None
    return strings_map.get(pn_ref)


def resolve_device_display_name(strings_map, general_string_el, product_id_text):
    catalog = strings_map.get(1)
    if catalog and str(catalog).strip():
        return str(catalog).strip()

    product_long = resolve_product_name_string(strings_map, general_string_el)
    if product_long and str(product_long).strip():
        return str(product_long).strip()

    if product_id_text and str(product_id_text).strip():
        return str(product_id_text).strip()

    return None


def format_firmware_version(device):
    parts = []
    general_count = device.find("GeneralCount")
    if general_count is not None:
        boot_ver = get_child_text(general_count, "BootloaderVersion", "")
        if boot_ver:
            parts.append(f"bootloader {boot_ver}")

    boot_general = device.find("BootLoaderGeneral")
    if boot_general is not None:
        for proc in boot_general.findall("processor"):
            idx = proc.get("index")
            hw = get_child_text(proc, "hw", "")
            sw = get_child_text(proc, "sw", "")
            label = f"proc {idx}" if idx is not None else "proc"
            if hw or sw:
                parts.append(f"{label} hw {hw} sw {sw}")

    if not parts:
        return None
    return "; ".join(parts)


def build_device_summary_record(device, bus_id, strings_map):
    general_string = device.find("GeneralString")
    boot_general = device.find("BootLoaderGeneral")
    general_count = device.find("GeneralCount")

    product_id = get_child_text(boot_general, "ProductID", "") if boot_general is not None else ""
    product_id = product_id or None

    software_version = None
    if general_count is not None:
        sv = get_child_text(general_count, "SoftwareVersion", "")
        software_version = sv or None

    firmware_version = format_firmware_version(device)

    serial_number = resolve_serial_number(strings_map, general_string)
    serial_number = serial_number or None

    product_name = resolve_product_name_string(strings_map, general_string)
    product_name = product_name or None

    display_name = resolve_device_display_name(strings_map, general_string, product_id)
    if not display_name:
        display_name = f"Device {bus_id}"

    return {
        "kind": "device_summary",
        "bus_id": bus_id,
        "device_name": display_name,
        "product_id": product_id,
        "serial_number": serial_number,
        "firmware_version": firmware_version,
        "software_version": software_version,
        "product_name": product_name,
    }


def parse_variable(variable, bus_id, section_name, strings_map, group_map):
    if to_int(get_child_text(variable, "eventable", "0"), 0) == 1:
        return None

    index = to_int(variable.get("index"))
    group_labels = group_map.get(index, [])
    group_label = pick_best_group(group_labels)
    visualization_type = to_int(get_child_text(variable, "VisualizationType", ""))
    parsed_type = resolve_type(visualization_type, section_name)
    if index is None or parsed_type is None:
        return None

    text_value_id = to_int(get_child_text(variable, "TextValueID", ""))
    unit_string_id = to_int(get_child_text(variable, "UnitStringID", "0"), 0)
    writeable = get_child_text(variable, "writeable", "0") == "1"

    label = strings_map.get(text_value_id, "") if text_value_id is not None else ""
    unit = strings_map.get(unit_string_id) if unit_string_id else None

    if parsed_type == "numeric":
        value = parse_numeric_value(variable)
    elif parsed_type == "enum":
        value = parse_enum_value(variable, strings_map)
    elif parsed_type == "boolean":
        value = parse_boolean_value(variable)
    elif parsed_type == "string":
        value = parse_string_value(variable, strings_map)
    else:
        return None

    return {
        "bus_id": bus_id,
        "section": section_name,
        "group": group_label,
        "groups": group_labels,
        "index": index,
        "label": label,
        "value": value,
        "unit": unit,
        "type": parsed_type,
        "writeable": writeable,
    }


def iter_records(root):
    for device in root.iter("device"):
        bus_id = to_int(device.get("BusID"))
        if bus_id is None:
            continue

        strings_map = load_strings_map(device)
        yield build_device_summary_record(device, bus_id, strings_map)

        for section_name in ("monitoring", "alarm", "history"):
            section = device.find(section_name)
            if section is None:
                continue

            group_map = build_group_map_for_section(section, strings_map)

            variables_parent = section.find("variables")
            variable_nodes = variables_parent.findall("variable") if variables_parent is not None else section.findall("variable")

            for variable in variable_nodes:
                record = parse_variable(variable, bus_id, section_name, strings_map, group_map)
                if record is not None:
                    yield record


def parse_snapshot(input_path, output_path):
    tree = ET.parse(input_path)
    root = tree.getroot()
    strip_namespace(root)

    with open(output_path, "w", encoding="utf-8") as out_file:
        for record in iter_records(root):
            out_file.write(json.dumps(record, ensure_ascii=False) + "\n")


def main():
    input_path = "snapshot.xml"
    if len(sys.argv) > 1:
        input_path = sys.argv[1]

    output_path = "snapshot_parsed.jsonl"

    try:
        parse_snapshot(input_path, output_path)
    except Exception as exc:
        print(f"Failed to parse snapshot: {exc}")


if __name__ == "__main__":
    main()
