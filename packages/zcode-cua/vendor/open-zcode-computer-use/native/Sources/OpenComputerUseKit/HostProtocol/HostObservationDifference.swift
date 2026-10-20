import Foundation

public enum HostObservationChangeKind: String, Codable, Equatable, Sendable {
    case none
    case remove
    case insert
    case update

    var rank: Int {
        switch self {
        case .none: 0
        case .remove: 1
        case .insert: 2
        case .update: 3
        }
    }
}

struct HostObservationRevisionNode: Equatable, Sendable {
    var identity: String
    var primaryText: String
    var token: String
    var stableId: Int?
    var children: [HostObservationRevisionNode]

    init(
        identity: String,
        primaryText: String? = nil,
        token: String? = nil,
        stableId: Int? = nil,
        children: [HostObservationRevisionNode] = []
    ) {
        self.identity = identity
        self.primaryText = primaryText ?? identity
        self.token = token ?? identity
        self.stableId = stableId
        self.children = children
    }
}

struct HostObservationChange: Equatable, Sendable {
    let kind: HostObservationChangeKind
    let path: [Int]
    let node: HostObservationRevisionNode
}

struct HostObservationRevision: Equatable, Sendable {
    var roots: [HostObservationRevisionNode]

    var maximumStableId: Int? {
        var result: Int?
        hostVisitRevisionNodes(roots) { node in
            guard let stableId = node.stableId else {
                return
            }
            result = max(result ?? stableId, stableId)
        }
        return result
    }
}

public enum HostObservationDifferencePresentation: String, Codable, Equatable, Sendable {
    case noChange = "no-change"
    case difference
    case full
}

public struct HostObservationRemovedRange: Codable, Equatable, Sendable {
    public let start: Int
    public let end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }
}

public struct HostObservationDifferenceChange: Codable, Equatable, Sendable {
    public let kind: HostObservationChangeKind
    public let path: [Int]
    public let stableId: Int
    public let token: String?
}

public struct HostObservationDifferencePayload: Codable, Equatable, Sendable {
    public let baseSnapshotId: String
    public let presentation: HostObservationDifferencePresentation
    public let changes: [HostObservationDifferenceChange]
    public let removedStableIdRanges: [HostObservationRemovedRange]
}

struct HostObservationAppendResult: Equatable, Sendable {
    let revision: HostObservationRevision
    let changes: [HostObservationChange]
    let removedStableIds: [Int]
}

func hostObservationRevision(
    from elements: [HostObservedElement]
) -> HostObservationRevision {
    let byToken = Dictionary(uniqueKeysWithValues: elements.map { ($0.token, $0) })
    var childTokens: [String: [String]] = [:]
    var rootTokens: [String] = []
    for element in elements {
        if let parent = element.parentToken, byToken[parent] != nil {
            childTokens[parent, default: []].append(element.token)
        } else {
            rootTokens.append(element.token)
        }
    }

    var visited = Set<String>()
    func makeNode(_ token: String) -> HostObservationRevisionNode? {
        guard visited.insert(token).inserted, let element = byToken[token] else {
            return nil
        }
        return HostObservationRevisionNode(
            identity: hostObservationIdentity(element),
            primaryText: hostObservationPrimaryText(element),
            token: token,
            children: (childTokens[token] ?? []).compactMap(makeNode)
        )
    }

    var roots = rootTokens.compactMap(makeNode)
    for element in elements where !visited.contains(element.token) {
        if let root = makeNode(element.token) {
            roots.append(root)
        }
    }
    return HostObservationRevision(roots: roots)
}

func hostAssignRootStableIds(
    _ revision: HostObservationRevision
) -> HostObservationRevision {
    var revision = revision
    var nextId = 0
    hostMutateRevisionNodes(&revision.roots) { node in
        node.stableId = nextId
        nextId += 1
    }
    return revision
}

func hostAppendObservationRevision(
    previous: HostObservationRevision,
    current: HostObservationRevision
) -> HostObservationAppendResult {
    var current = current
    var changes: [HostObservationChange] = []
    var removedStableIds: [Int] = []
    hostDiffSiblingLists(
        previous.roots,
        &current.roots,
        parentPath: [],
        changes: &changes,
        removedStableIds: &removedStableIds
    )

    var nextId = (previous.maximumStableId ?? -1) + 1
    hostMutateRevisionNodes(&current.roots) { node in
        if node.stableId == nil {
            node.stableId = nextId
            nextId += 1
        }
    }

    var currentByToken: [String: HostObservationRevisionNode] = [:]
    hostVisitRevisionNodes(current.roots) { node in
        currentByToken[node.token] = node
    }
    let resolvedChanges = changes.map { change in
        guard change.kind != .remove,
              let currentNode = currentByToken[change.node.token]
        else {
            return change
        }
        return HostObservationChange(
            kind: change.kind,
            path: change.path,
            node: currentNode
        )
    }

    return HostObservationAppendResult(
        revision: current,
        changes: hostSortObservationChanges(resolvedChanges),
        removedStableIds: Array(Set(removedStableIds)).sorted()
    )
}

func hostObservationDifferencePayload(
    baseSnapshotId: String,
    appendResult: HostObservationAppendResult,
    fullLineCount: Int
) -> HostObservationDifferencePayload {
    let effective = appendResult.changes.filter { $0.kind != .none }
    let removedRanges = hostCompressRemovedStableIds(
        appendResult.removedStableIds
    )
    let renderedChangeCount = effective.filter { $0.kind != .remove }.count
    let presentation = hostChooseDifferencePresentation(
        differenceLineCount: renderedChangeCount + (removedRanges.isEmpty ? 0 : 1),
        effectiveChangeCount: effective.count,
        fullLineCount: fullLineCount,
        removedSummaryLineCount: removedRanges.isEmpty ? 0 : 1
    )
    let changes: [HostObservationDifferenceChange]
    if presentation == .full {
        changes = []
    } else {
        changes = effective.compactMap { change in
            guard let stableId = change.node.stableId else {
                return nil
            }
            return HostObservationDifferenceChange(
                kind: change.kind,
                path: change.path,
                stableId: stableId,
                token: change.kind == .remove ? nil : change.node.token
            )
        }
    }
    return HostObservationDifferencePayload(
        baseSnapshotId: baseSnapshotId,
        presentation: presentation,
        changes: changes,
        removedStableIdRanges: removedRanges
    )
}

func hostApplyingStableIds(
    _ result: HostTreeWalkResult,
    revision: HostObservationRevision
) -> HostTreeWalkResult {
    var stableIds: [String: Int] = [:]
    hostVisitRevisionNodes(revision.roots) { node in
        if let stableId = node.stableId {
            stableIds[node.token] = stableId
        }
    }
    let observedByToken = Dictionary(
        uniqueKeysWithValues: result.elements.map { element in
            let observed = HostObservedElement(
                token: element.token,
                stableId: stableIds[element.token],
                parentToken: element.parentToken,
                depth: element.depth,
                role: element.role,
                subrole: element.subrole,
                axIdentifier: element.axIdentifier,
                title: element.title,
                label: element.label,
                value: element.value,
                placeholder: element.placeholder,
                enabled: element.enabled,
                focused: element.focused,
                selected: element.selected,
                frame: element.frame,
                actions: element.actions,
                digest: element.digest,
                truncated: element.truncated
            )
            return (element.token, observed)
        }
    )
    let bindings = result.bindings.compactMap { binding -> HostElementBinding? in
        guard let observed = observedByToken[binding.token] else {
            return nil
        }
        return HostElementBinding(
            token: binding.token,
            parentToken: binding.parentToken,
            depth: binding.depth,
            pid: binding.pid,
            processStartTime: binding.processStartTime,
            dispatchPid: binding.dispatchPid,
            dispatchProcessStartTime: binding.dispatchProcessStartTime,
            digestInput: binding.digestInput,
            element: binding.element,
            observed: observed,
            isMenu: binding.isMenu
        )
    }
    return HostTreeWalkResult(
        elements: result.elements.compactMap { observedByToken[$0.token] },
        bindings: bindings,
        truncated: result.truncated,
        focusedToken: result.focusedToken
    )
}

func hostSortObservationChanges(
    _ changes: [HostObservationChange]
) -> [HostObservationChange] {
    changes.sorted { left, right in
        let pathOrder = hostCompareIndexPaths(left.path, right.path)
        if pathOrder != 0 {
            return pathOrder < 0
        }
        return left.kind.rank < right.kind.rank
    }
}

func hostCompressRemovedStableIds(
    _ ids: [Int]
) -> [HostObservationRemovedRange] {
    let sorted = Array(Set(ids)).sorted()
    var ranges: [HostObservationRemovedRange] = []
    for id in sorted {
        if let last = ranges.last, id == last.end + 1 {
            ranges[ranges.count - 1] = HostObservationRemovedRange(
                start: last.start,
                end: id
            )
        } else {
            ranges.append(HostObservationRemovedRange(start: id, end: id))
        }
    }
    return ranges
}

func hostChooseDifferencePresentation(
    differenceLineCount: Int,
    effectiveChangeCount: Int,
    fullLineCount: Int,
    removedSummaryLineCount: Int = 0,
    ignoreDifferenceLineBudget: Bool = false
) -> HostObservationDifferencePresentation {
    if effectiveChangeCount == 0 {
        return .noChange
    }
    if !ignoreDifferenceLineBudget,
       removedSummaryLineCount > fullLineCount
        || differenceLineCount > fullLineCount {
        return .full
    }
    return .difference
}

private func hostDiffMatchedNode(
    _ oldNode: HostObservationRevisionNode,
    _ newNode: inout HostObservationRevisionNode,
    path: [Int],
    changes: inout [HostObservationChange],
    removedStableIds: inout [Int]
) {
    guard oldNode.identity == newNode.identity else {
        changes.append(HostObservationChange(kind: .remove, path: path, node: oldNode))
        changes.append(HostObservationChange(kind: .insert, path: path, node: newNode))
        hostCollectStableIds(oldNode, into: &removedStableIds)
        return
    }

    newNode.stableId = oldNode.stableId
    changes.append(
        HostObservationChange(
            kind: oldNode.primaryText == newNode.primaryText ? .none : .update,
            path: path,
            node: newNode
        )
    )
    hostDiffSiblingLists(
        oldNode.children,
        &newNode.children,
        parentPath: path,
        changes: &changes,
        removedStableIds: &removedStableIds
    )
}

private func hostObservationIdentity(_ element: HostObservedElement) -> String {
    let stableName: String
    if let identifier = element.axIdentifier, !identifier.isEmpty {
        stableName = "id:\(identifier)"
    } else {
        stableName = [
            element.title ?? "",
            element.label ?? "",
            element.placeholder ?? "",
        ].joined(separator: "\u{1f}")
    }
    return [
        element.role,
        element.subrole ?? "",
        stableName,
    ].joined(separator: "\u{1e}")
}

private func hostObservationPrimaryText(_ element: HostObservedElement) -> String {
    // Swift 5.10 对长泛型表达式推导超时；显式分解不改变快照 diff 身份。
    let selected = element.selected.map { String($0) } ?? ""
    let frame = element.frame.map { "\($0.x),\($0.y),\($0.width),\($0.height)" } ?? ""
    let parts: [String] = [
        element.role,
        element.subrole ?? "",
        element.title ?? "",
        element.label ?? "",
        element.value ?? "",
        element.placeholder ?? "",
        element.enabled ? "enabled" : "disabled",
        element.focused ? "focused" : "",
        selected,
        frame,
        element.actions.map(\.rawValue).joined(separator: ","),
    ]
    return parts.joined(separator: "\u{1f}")
}

private func hostDiffSiblingLists(
    _ oldNodes: [HostObservationRevisionNode],
    _ newNodes: inout [HostObservationRevisionNode],
    parentPath: [Int],
    changes: inout [HostObservationChange],
    removedStableIds: inout [Int]
) {
    var oldIndexesByIdentity: [String: [Int]] = [:]
    for (index, node) in oldNodes.enumerated() {
        oldIndexesByIdentity[node.identity, default: []].append(index)
    }

    var matchedOld = Set<Int>()
    var matchedNew = Set<Int>()
    for newIndex in newNodes.indices {
        let identity = newNodes[newIndex].identity
        guard let oldIndex = oldIndexesByIdentity[identity]?.first(where: {
            !matchedOld.contains($0)
        }) else {
            continue
        }
        matchedOld.insert(oldIndex)
        matchedNew.insert(newIndex)
        hostDiffMatchedNode(
            oldNodes[oldIndex],
            &newNodes[newIndex],
            path: parentPath + [newIndex],
            changes: &changes,
            removedStableIds: &removedStableIds
        )
    }

    for oldIndex in oldNodes.indices where !matchedOld.contains(oldIndex) {
        let node = oldNodes[oldIndex]
        changes.append(
            HostObservationChange(
                kind: .remove,
                path: parentPath + [oldIndex],
                node: node
            )
        )
        hostCollectStableIds(node, into: &removedStableIds)
    }
    for newIndex in newNodes.indices where !matchedNew.contains(newIndex) {
        changes.append(
            HostObservationChange(
                kind: .insert,
                path: parentPath + [newIndex],
                node: newNodes[newIndex]
            )
        )
    }
}

private func hostCompareIndexPaths(_ left: [Int], _ right: [Int]) -> Int {
    for index in 0..<min(left.count, right.count) {
        if left[index] != right[index] {
            return left[index] - right[index]
        }
    }
    return left.count - right.count
}

private func hostCollectStableIds(
    _ node: HostObservationRevisionNode,
    into result: inout [Int]
) {
    if let stableId = node.stableId {
        result.append(stableId)
    }
    for child in node.children {
        hostCollectStableIds(child, into: &result)
    }
}

private func hostVisitRevisionNodes(
    _ nodes: [HostObservationRevisionNode],
    visit: (HostObservationRevisionNode) -> Void
) {
    for node in nodes {
        visit(node)
        hostVisitRevisionNodes(node.children, visit: visit)
    }
}

private func hostMutateRevisionNodes(
    _ nodes: inout [HostObservationRevisionNode],
    mutate: (inout HostObservationRevisionNode) -> Void
) {
    for index in nodes.indices {
        mutate(&nodes[index])
        hostMutateRevisionNodes(&nodes[index].children, mutate: mutate)
    }
}
