RC_OK = 0


class InvalidActionError(Exception):
	"""InvalidActionError: Action does not exist"""
	def __init__(self, vname):
		super().__init__("InvalidActionError: Action does not exist: {}".format(vname))
		self.status = 500


class ActionAlreadyExists(Exception):
	"""ActionAlreadyExists: Action does not exist"""
	def __init__(self, vname):
		super().__init__("ActionAlreadyExists: Action already exists: {}".format(vname))
		self.status = 500


class MissingArgumentError(Exception):
	"""MissingArgumentError: Missing Argument"""
	def __init__(self, vname):
		super().__init__("MissingArgumentError: Missing the argument: {}".format(vname))
		self.status = 500


class ActionInvokeError(Exception):
	"""ActionInvokeError"""
	def __init__(self, vname, err):
		super().__init__("ActionInvokeError: Error in invoking action {}: {}".format(vname, err))
		self.status = 500


class ActionCompileError(Exception):
	"""ActionCompileError"""
	def __init__(self, vname):
		super().__init__("ActionCompileError: Error in compiling action {}".format(vname))
		self.status = 500


class InvalidSignatureError(Exception):
	"""InvalidSignatureError: Argument Mismatch"""
	def __init__(self, vname):
		super().__init__("InvalidSignatureError: Mismatch in arguments for action {}".format(vname))
		self.status = 500


class InvalidRuntimeError(Exception):
	"""InvalidRuntimeError: Invalid runtime"""
	def __init__(self, vname):
		super().__init__("InvalidRuntimeError: Invalid runtime")
		self.status = 500

