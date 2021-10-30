from abc import ABC, abstractmethod

class ActionInterface(ABC):
	def __init__(self):
		self.action_name = None
		self.action_code = None
		self.language = None
	
	@abstractmethod
	def create(self):
		pass
	
	@abstractmethod
	def get(self):
		pass
	
	@abstractmethod
	def update(self):
		pass

	@abstractmethod
	def delete(self):
		pass

	@abstractmethod
	def invoke(self):
		pass
